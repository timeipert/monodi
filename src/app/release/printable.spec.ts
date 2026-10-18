import { holdReasons, isPrintable, withReleaseFields } from './printable';

describe('holdReasons', () => {
  const doc = (editionsstatus: string, custom?: Record<string, string>) => ({ editionsstatus, custom });

  it('lets an ordinary document through', () => {
    expect(holdReasons(doc('ediert'))).toEqual([]);
    expect(isPrintable(doc('ediert', { dontpublish: '' }))).toBeTrue();
  });

  it('holds back what is marked "don\'t publish", whatever the mark says', () => {
    expect(holdReasons(doc('ediert', { dontpublish: 'x' }))).toEqual(['dontpublish']);
    expect(holdReasons(doc('ediert', { dontpublish: 'Zweite Melodie Quelle: Alme rex pie' }))).toEqual(['dontpublish']);
    expect(holdReasons(doc('ediert', { dontpublish: '   ' }))).toEqual([]);
  });

  it('holds back documents whose edition status is "none", not those without a status', () => {
    expect(holdReasons(doc('none'))).toEqual(['not-edited']);
    expect(holdReasons(doc(' None '))).toEqual(['not-edited']);
    expect(holdReasons(doc(''))).toEqual([]);
    expect(isPrintable({ editionsstatus: undefined as any })).toBeTrue();
  });

  it('names both reasons', () => {
    expect(holdReasons(doc('none', { dontpublish: 'x' }))).toEqual(['dontpublish', 'not-edited']);
  });

  it('does not hold back a document that is not there', () => {
    expect(holdReasons(null)).toEqual([]);
  });

  it('does not use the metadata flag: it hides nothing from the print yet', () => {
    expect(holdReasons(doc('ediert', { dontpublish_metadata: 'x' }))).toEqual([]);
  });
});

describe('withReleaseFields', () => {
  it('adds the two fields once and keeps the others', () => {
    const s = { customDocumentFields: [{ key: 'a', label: 'A' }] };
    const once = withReleaseFields(s)!;
    expect(once.customDocumentFields!.map((f) => f.key)).toEqual(['a', 'dontpublish', 'dontpublish_metadata']);
    expect(withReleaseFields(once)).toBeNull();
    expect(s.customDocumentFields.length).toBe(1);
  });

  it('works on settings without any custom fields', () => {
    const empty: { customDocumentFields?: { key: string; label: string }[] } = {};
    expect(withReleaseFields(empty)!.customDocumentFields!.length).toBe(2);
  });
});
