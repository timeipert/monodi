import {
  CM_FREQUENCY, buildFrequency, classify, compareForTable, directionOf, mostFrequentForms, searchPatterns, signatureOf, sortForTable, toneCount
} from './notation-order';

describe('notation order (as the Neumen-Editor orders its neume table)', () => {
  describe('reading a code', () => {
    it('takes the signature, the direction and the tones out of a code', () => {
      expect(signatureOf('[*u]dL')).toBe('*udL');
      expect(directionOf('[*u]dL')).toBe('*ud');
      expect(toneCount('[*u]dL')).toBe(3);
      expect(toneCount('*SeS')).toBe(2);
      expect(signatureOf('*ud b')).toBe('*ud');         // an old variant letter is not part of the code
    });

    it('sorts a code into plain shapes and the groups of its first special sign', () => {
      expect(classify('[*u]d')).toEqual(jasmine.objectContaining({ kind: 'direction', direction: '*ud' }));
      expect(classify('[*dL]')).toEqual(jasmine.objectContaining({ kind: 'special', sign: 'L' }));
      expect(classify('*QuL')).toEqual(jasmine.objectContaining({ kind: 'special', sign: 'Q' }));   // the first sign decides
      expect(classify('*uVd')).toEqual(jasmine.objectContaining({ kind: 'custom' }));
      expect(classify('(Start)').kind).toBe('other');
    });
  });

  describe('frequency', () => {
    it('counts a direction over every way of writing it, brackets and signs ignored', () => {
      const f = buildFrequency({ '[*d]': 10, '*d': 5, '[*dL]': 2, '*u': 7 });
      expect(f.direction('*d')).toBe(17);
      expect(f.signature('*dL')).toBe(2);
      expect(f.code('[*d]')).toBe(10);
    });

    it('knows the Corpus Monodicum: a single note is by far the most frequent', () => {
      expect(CM_FREQUENCY.direction('*')).toBeGreaterThan(CM_FREQUENCY.direction('*d'));
      expect(CM_FREQUENCY.direction('*d')).toBeGreaterThan(CM_FREQUENCY.direction('*u'));
    });
  });

  describe('order of the table', () => {
    it('reproduces the editorial order of the standard table: * | *d *u *e | *dd *ud *uu *du | *udd *uud *ddu', () => {
      const shuffled = ['*ddu', '*du', '*u', '*uu', '*', '*udd', '*e', '*dd', '*d', '*uud', '*ud'];
      expect(sortForTable(shuffled)).toEqual(['*', '*d', '*u', '*e', '*dd', '*ud', '*uu', '*du', '*udd', '*uud', '*ddu']);
    });

    it('puts the special signs after the plain shapes, one group each: L, O, Q, then S', () => {
      const codes = ['*SeS', '[*Qu]', '[*dL]', '*dd', '[*eO]', '[*uL]', '*'];
      expect(sortForTable(codes)).toEqual(['*', '*dd', '[*dL]', '[*uL]', '[*eO]', '[*Qu]', '*SeS']);
    });

    it('puts the ways of writing one shape in the order of how often they occur', () => {
      expect(sortForTable(['*d', '[*d]'])).toEqual(['[*d]', '*d']);      // [*d] is written far more often than *d
    });

    it('is a total order that does not depend on the input order', () => {
      const codes = ['[*u]dd', '*udd', '*uu', '[*uu]', '*ud', '[*ud]', '[*dL]', '*e', '*'];
      expect(sortForTable([...codes].reverse())).toEqual(sortForTable(codes));
      expect(codes.every(c => compareForTable(c, c) === 0)).toBeTrue();
    });
  });

  describe('library', () => {
    it('finds patterns by signature, brackets ignored, in the order of the table', () => {
      const hits = searchPatterns('*ud');
      expect(hits.length).toBeGreaterThan(2);
      expect(hits.every(h => signatureOf(h).includes('*ud'))).toBeTrue();
      expect(hits).toEqual(sortForTable(hits));
    });

    it('matches a code with brackets as written, and leaves out what it was told to', () => {
      expect(searchPatterns('[*u]dd').every(h => h.includes('[*u]dd'))).toBeTrue();
      expect(searchPatterns('*ud', new Set(['[*ud]'])).includes('[*ud]')).toBeFalse();
      expect(searchPatterns('  ')).toEqual([]);
    });

    it('names the most frequent way of writing each shape', () => {
      const forms = mostFrequentForms(['*', '*d', '*u']);
      expect(forms[0]).toBe('*');
      expect(forms[1]).toBe('[*d]');
      expect(forms[2]).toBe('[*u]');
    });
  });
});
