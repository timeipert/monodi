import { IdSelection, uniqueIds } from './selection-set';

describe('uniqueIds', () => {
  it('drops repeats and empty entries and keeps the order', () => {
    expect(uniqueIds(['b', 'a', 'b', '', null, undefined, 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});

describe('IdSelection', () => {
  const universe = ['a', 'b', 'c', 'd', 'e'];

  it('selects every id of the universe, not only a page of it', () => {
    const s = new IdSelection();
    s.selectAll(universe);
    expect(s.size).toBe(5);
    expect(s.stateOf(universe)).toBe('all');
  });

  it('keeps ids outside the universe when selecting all and inverting', () => {
    const s = new IdSelection();
    s.add(['x', 'a']);
    s.selectAll(universe);
    expect(s.has('x')).toBeTrue();
    s.invert(universe);
    expect(s.ids()).toEqual(['x']);
  });

  it('inverts inside the universe: the complement of the selection', () => {
    const s = new IdSelection();
    s.add(['a', 'c']);
    s.invert(universe);
    expect(s.ids().sort()).toEqual(['b', 'd', 'e']);
    s.invert(universe);
    expect(s.ids().sort()).toEqual(['a', 'c']);
  });

  it('inverting a universe with repeated ids flips each id once', () => {
    const s = new IdSelection();
    s.invert(['a', 'a', 'b']);
    expect(s.ids().sort()).toEqual(['a', 'b']);
  });

  it('keepOnly drops everything outside the hits', () => {
    const s = new IdSelection();
    s.add(['a', 'z', 'c']);
    s.keepOnly(['a', 'b', 'c']);
    expect(s.ids()).toEqual(['a', 'c']);
  });

  it('reports none, some and all for a universe; an empty universe is none', () => {
    const s = new IdSelection();
    expect(s.stateOf(universe)).toBe('none');
    s.add(['a']);
    expect(s.stateOf(universe)).toBe('some');
    s.add(['b', 'c', 'd', 'e']);
    expect(s.stateOf(universe)).toBe('all');
    expect(s.stateOf([])).toBe('none');
  });

  it('counts how many were added or removed and bumps the version only on a change', () => {
    const s = new IdSelection();
    const v0 = s.version;
    expect(s.add(['a', 'b'])).toBe(2);
    expect(s.add(['b'])).toBe(0);
    const v1 = s.version;
    expect(v1).toBeGreaterThan(v0);
    expect(s.add(['a'])).toBe(0);
    expect(s.version).toBe(v1);
    expect(s.remove(['a', 'q'])).toBe(1);
    expect(s.version).toBeGreaterThan(v1);
  });

  it('toggle flips one id and says what it is now', () => {
    const s = new IdSelection();
    expect(s.toggle('a')).toBeTrue();
    expect(s.toggle('a')).toBeFalse();
    expect(s.size).toBe(0);
  });

  it('clear and replace', () => {
    const s = new IdSelection();
    s.add(['a', 'b']);
    s.replace(['x']);
    expect(s.ids()).toEqual(['x']);
    s.clear();
    expect(s.size).toBe(0);
  });

  it('stays correct and fast for thousands of ids', () => {
    const many = Array.from({ length: 30000 }, (_, i) => `id${i}`);
    const s = new IdSelection();
    const t0 = performance.now();
    s.selectAll(many);
    s.invert(many.slice(0, 15000));
    expect(s.size).toBe(15000);
    expect(s.stateOf(many)).toBe('some');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
