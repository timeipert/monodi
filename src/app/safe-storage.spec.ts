import { safeStorage } from './safe-storage';

describe('safeStorage', () => {
  const key = 'monodi_safe_storage_test';
  afterEach(() => { localStorage.removeItem(key); });

  it('stores and reads strings and JSON', () => {
    expect(safeStorage.set(key, 'x')).toBeTrue();
    expect(safeStorage.get(key)).toBe('x');
    expect(safeStorage.setJson(key, { a: [1, 2] })).toBeTrue();
    expect(safeStorage.getJson<unknown>(key, null)).toEqual({ a: [1, 2] });
    safeStorage.remove(key);
    expect(safeStorage.get(key)).toBeNull();
  });

  it('falls back when the JSON is missing or broken', () => {
    expect(safeStorage.getJson(key, 'fallback')).toBe('fallback');
    localStorage.setItem(key, '{not json');
    expect(safeStorage.getJson(key, ['fallback'])).toEqual(['fallback']);
  });

  it('does not throw when the browser refuses access', () => {
    const spies = [
      spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError'),
      spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError'),
      spyOn(Storage.prototype, 'removeItem').and.throwError('SecurityError'),
    ];
    expect(safeStorage.get(key)).toBeNull();
    expect(safeStorage.set(key, 'x')).toBeFalse();
    expect(safeStorage.getJson(key, 7)).toBe(7);
    expect(safeStorage.setJson(key, {})).toBeFalse();
    expect(() => safeStorage.remove(key)).not.toThrow();
    spies.forEach(spy => spy.and.callThrough());   // the cleanup in afterEach needs a working storage again
  });

  it('reports a value that cannot be serialised instead of throwing', () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    expect(safeStorage.setJson(key, cyclic)).toBeFalse();
  });
});
