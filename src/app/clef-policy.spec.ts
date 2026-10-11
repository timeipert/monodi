import { shouldShowClef, sanitizeClefDisplayMode, ClefContext } from './clef-policy';

const none: ClefContext = { firstInDocument: false, firstInZeile: false, afterLineChange: false, wrapStart: false };

describe('clef-policy', () => {
  it('always shows the clef at the document start', () => {
    for (const m of ['document-start', 'every-line', 'every-break'] as const) {
      expect(shouldShowClef(m, { ...none, firstInDocument: true })).toBeTrue();
    }
  });

  it('document-start: nowhere else', () => {
    expect(shouldShowClef('document-start', { ...none, firstInZeile: true })).toBeFalse();
    expect(shouldShowClef('document-start', { ...none, afterLineChange: true })).toBeFalse();
    expect(shouldShowClef('document-start', { ...none, wrapStart: true })).toBeFalse();
  });

  it('every-line: first of each Zeile, not after breaks or wraps', () => {
    expect(shouldShowClef('every-line', { ...none, firstInZeile: true })).toBeTrue();
    expect(shouldShowClef('every-line', { ...none, afterLineChange: true })).toBeFalse();
    expect(shouldShowClef('every-line', { ...none, wrapStart: true })).toBeFalse();
  });

  it('every-break: Zeile start, after LineChange and on wrapped systems', () => {
    expect(shouldShowClef('every-break', { ...none, firstInZeile: true })).toBeTrue();
    expect(shouldShowClef('every-break', { ...none, afterLineChange: true })).toBeTrue();
    expect(shouldShowClef('every-break', { ...none, wrapStart: true })).toBeTrue();
    expect(shouldShowClef('every-break', none)).toBeFalse();
  });

  it('sanitizes unknown values to the default', () => {
    expect(sanitizeClefDisplayMode('nonsense')).toBe('document-start');
    expect(sanitizeClefDisplayMode(undefined)).toBe('document-start');
    expect(sanitizeClefDisplayMode('every-line')).toBe('every-line');
  });
});
