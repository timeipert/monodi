import { candidatesFor, DEFAULT_STANDARD, defaultSetup, includedRows, NOTATION_SET_KEY, NotationSetup, readSetup, readSourceSet, setIncluded, settingsOf, writeSourceSet } from './notation-set';

const setup: NotationSetup = { standard: [{ pattern: '*', refId: '10' }, { pattern: '[*d]', refId: '20' }, { pattern: '*dd', refId: '30' }], order: 'neume' };
const item = (id: string, pattern: string) => ({ id, regionId: 'r', pattern, points: '0,0 1,0 1,1 0,1' });

describe('notation set', () => {
  describe('the workspace setup', () => {
    it('is the default when the settings say nothing', () => {
      expect(readSetup(null)).toEqual(defaultSetup());
      expect(readSetup({})).toEqual(defaultSetup());
      expect(defaultSetup().standard.length).toBe(DEFAULT_STANDARD.length);
    });

    it('does not hand out the default itself, so that changing a setup cannot change the default', () => {
      const a = defaultSetup();
      a.standard[0].refId = 'changed';
      expect(defaultSetup().standard[0].refId).toBe('10');
    });

    it('reads what the settings hold, cleaned: no empty or repeated pattern, the first wins, IDs trimmed', () => {
      const s = readSetup({ notationStandard: [{ pattern: ' [*d] ', refId: ' 20 ' }, { pattern: '', refId: '1' }, { pattern: '[*d]', refId: '99' }, { pattern: '*', refId: null }], notationOrder: 'id' });
      expect(s.standard).toEqual([{ pattern: '[*d]', refId: '20' }, { pattern: '*', refId: '' }]);
      expect(s.order).toBe('id');
    });

    it('keeps an empty standard set empty (the user may want none) and ignores an unknown order', () => {
      const s = readSetup({ notationStandard: [], notationOrder: 'whatever' });
      expect(s.standard).toEqual([]);
      expect(s.order).toBe('id');            // the default: by Reference ID, then as the neume table
      expect(readSetup({ notationOrder: 'neume' }).order).toBe('neume');
    });

    it('round-trips through the settings', () => {
      expect(readSetup(settingsOf(setup))).toEqual(setup);
    });
  });

  describe('what a source changes', () => {
    it('reads and writes its changes in Source.custom, and drops the entry when there are none', () => {
      const src: any = {};
      writeSourceSet(src, { add: ['*u'], remove: ['*dd'] });
      expect(readSourceSet(src)).toEqual({ add: ['*u'], remove: ['*dd'] });
      writeSourceSet(src, { add: [], remove: [] });
      expect(src.custom[NOTATION_SET_KEY]).toBeUndefined();
    });

    it('survives an entry that cannot be read, and a pattern both added and removed counts as added', () => {
      expect(readSourceSet({ custom: { [NOTATION_SET_KEY]: '{nonsense' } })).toEqual({ add: [], remove: [] });
      expect(readSourceSet({ custom: { [NOTATION_SET_KEY]: JSON.stringify({ add: ['*u'], remove: ['*u', '*d'] }) } })).toEqual({ add: ['*u'], remove: ['*d'] });
    });
  });

  describe('candidates and what is shown', () => {
    const source: any = {
      equivalents: [{ pattern: '*', refId: '11' }, { pattern: '*ud', refId: '41' }, { pattern: '*uu', refId: '50' }],
      annotationItems: [item('1', '*'), item('2', '*ud'), item('3', '*ud')],
    };

    it('shows the standard set and what has snippets; a row of the neume table alone is only offered', () => {
      const c = candidatesFor(source, setup);
      const by = Object.fromEntries(c.map(x => [x.pattern, x]));
      expect(by['*'].included).toBeTrue();            // standard, and snippets
      expect(by['[*d]'].included).toBeTrue();         // standard only: shown without snippets
      expect(by['*ud'].included).toBeTrue();          // snippets only
      expect(by['*uu'].included).toBeFalse();         // a table row only
      expect(by['*uu'].origins).toEqual(['table']);
      expect(by['*ud'].snippets).toBe(2);
    });

    it('is in the order of the neume table', () => {
      expect(candidatesFor(source, setup).map(x => x.pattern)).toEqual(['*', '[*d]', '*dd', '*ud', '*uu']);
    });

    it('takes the ID from the manuscript\'s own table first, then from the standard set', () => {
      const by = Object.fromEntries(candidatesFor(source, setup).map(x => [x.pattern, x.refId]));
      expect(by['*']).toBe('11');          // its own
      expect(by['[*d]']).toBe('20');       // the standard's
      expect(by['*ud']).toBe('41');
      expect(candidatesFor({ annotationItems: [item('1', '*uud')] }, setup).find(x => x.pattern === '*uud')!.refId).toBe('');
    });

    it('lets a manuscript remove and add', () => {
      const edited = { ...source, custom: { [NOTATION_SET_KEY]: JSON.stringify({ add: ['*uu'], remove: ['*dd', '*ud'] }) } };
      const shown = includedRows(edited, setup).map(r => r.pattern);
      expect(shown).toContain('*uu');
      expect(shown).not.toContain('*dd');
      expect(shown).not.toContain('*ud');           // it has snippets, but the manuscript removed it
    });

    it('writes only what differs from the default: ticking a standard pattern off removes it, ticking it on again clears that', () => {
      const src: any = { ...source };
      setIncluded(src, setup, '[*d]', false);
      expect(readSourceSet(src)).toEqual({ add: [], remove: ['[*d]'] });
      setIncluded(src, setup, '[*d]', true);
      expect(readSourceSet(src)).toEqual({ add: [], remove: [] });
      expect(src.custom?.[NOTATION_SET_KEY]).toBeUndefined();
      // a table-only pattern is added, and ticking it off again is no change
      setIncluded(src, setup, '*uu', true);
      expect(readSourceSet(src)).toEqual({ add: ['*uu'], remove: [] });
      setIncluded(src, setup, '*uu', false);
      expect(readSourceSet(src)).toEqual({ add: [], remove: [] });
      // a pattern with snippets only: ticking it off removes it
      setIncluded(src, setup, '*ud', false);
      expect(readSourceSet(src).remove).toEqual(['*ud']);
    });

    it('shows the standard set for a manuscript without any annotation', () => {
      expect(includedRows({}, setup).map(r => r.pattern)).toEqual(['*', '[*d]', '*dd']);
      expect(includedRows(null, { ...setup, standard: [] })).toEqual([]);
    });
  });
});
