import { FieldJob, distinctValues, fieldValue, joinValues, makeLookup, sourceLine, splitFields, splitKey, splitLabel, splitSpec } from './fields';

function job(o: { id?: string; sigle?: string; ort?: string; bib?: string; sig?: string; region?: string; g1?: string; g2?: string; custom?: any; srcCustom?: any }): FieldJob {
  return {
    sigle: o.sigle ?? '',
    source: { id: o.id ?? 's1', quellensigle: o.sigle ?? '', herkunftsregion: o.region ?? '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '',
      bibliotheksort: o.ort ?? '', bibliothek: o.bib ?? '', bibliothekssignatur: o.sig ?? '', kommentar: '', datierung: '', custom: o.srcCustom } as any,
    document: { id: 'd', quelle_id: o.id ?? 's1', dokumenten_id: 'x', gattung1: o.g1 ?? '', gattung2: o.g2 ?? '', festtag: '', feier: '', textinitium: '', bibliographischerverweis: '',
      druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '', custom: o.custom } as any,
  };
}

const aachen = job({ id: 'a', sigle: 'Aa 13', ort: 'Aachen', bib: 'Domarchiv', sig: 'Hs. G 13', region: 'Rheinland', g1: 'Antiphon' });
const aachen2 = job({ id: 'a', sigle: 'Aa 13', ort: 'Aachen', bib: 'Domarchiv', sig: 'Hs. G 13', region: 'Rheinland', g1: 'Antiphon', g2: 'Invitatorium' });
const utrecht = job({ id: 'u', sigle: 'Ut 417', ort: 'Utrecht', bib: 'UB', sig: 'Ms. 417', region: 'Niederlande', g1: 'Responsorium', custom: { bearbeiter: 'N. N.' } });

describe('print fields', () => {
  it('reads source and document fields and the sigle', () => {
    expect(fieldValue(aachen, 'herkunftsregion')).toBe('Rheinland');
    expect(fieldValue(aachen, 'gattung1')).toBe('Antiphon');
    expect(fieldValue(aachen2, 'genre')).toBe('Antiphon / Invitatorium');
    expect(fieldValue(aachen, 'quellensigle')).toBe('Aa 13');
    expect(fieldValue(utrecht, 'bearbeiter')).toBe('N. N.');
    expect(fieldValue(aachen, 'gibtsnicht')).toBe('');
  });

  it('writes the manuscript as town, library, shelfmark', () => {
    expect(sourceLine(aachen)).toBe('Aachen, Domarchiv, Hs. G 13');
    expect(sourceLine({ ...aachen, source: null })).toBe('');
  });

  it('splits by manuscript with the sigle as the label, by other fields with their value', () => {
    expect(splitKey(aachen, 'quelle-id')).toEqual({ key: 'a', label: 'Aa 13', parts: ['Aa 13'] });
    expect(splitKey(utrecht, 'herkunftsregion')).toEqual({ key: 'Niederlande', label: 'Niederlande', parts: ['Niederlande'] });
    expect(splitKey(job({}), 'herkunftsregion')).toEqual({ key: '', label: '', parts: [''] });
  });

  it('offers the custom fields of the project for splitting', () => {
    const f = splitFields({ customSourceFields: [{ key: 'band', label: 'Band' }], customDocumentFields: [{ key: 'bearbeiter', label: 'Editor' }] } as any);
    expect(f.map((x) => x.key)).toContain('band');
    expect(f.map((x) => x.key)).toContain('bearbeiter');
    expect(f[0].key).toBe('quelle-id');
  });

  it('offers only fields that give a volume context, not folio, line, shelfmark or reference', () => {
    const keys = splitFields({} as any).map((x) => x.key);
    for (const k of ['foliostart', 'zeilenstart', 'bibliothekssignatur', 'quellensigle', 'bibliographischerverweis', 'dokumenten_id', 'textinitium', 'kommentar']) expect(keys).not.toContain(k);
    for (const k of ['quelle-id', 'genre', 'gattung1', 'herkunftsregion', 'herkunftsort', 'bibliotheksort', 'ordenstradition', 'quellentyp', 'feier', 'druckausgabe']) expect(keys).toContain(k);
  });

  it('splits by two fields: one volume per combination, e.g. genre and region of origin', () => {
    const spec = splitSpec('gattung1', 'herkunftsregion');
    expect(spec).toBe('gattung1+herkunftsregion');
    const a = splitKey(aachen, spec);
    expect(a.label).toBe('Antiphon · Rheinland');
    expect(a.parts).toEqual(['Antiphon', 'Rheinland']);
    // same genre, other region: another volume
    expect(splitKey(job({ g1: 'Antiphon', region: 'Niederlande' }), spec).key).not.toBe(a.key);
    // same combination: the same volume
    expect(splitKey(aachen2, spec).key).toBe(a.key);
    // one field missing is marked, both missing is the group without a value
    expect(splitKey(job({ g1: 'Antiphon' }), spec).label).toBe('Antiphon · (not set)');
    expect(splitKey(job({}), spec).key).toBe('');
  });

  it('a second field equal to the first, or none, is a split by one field', () => {
    expect(splitSpec('genre', '')).toBe('genre');
    expect(splitSpec('genre', 'genre')).toBe('genre');
    expect(splitSpec('', 'genre')).toBe('');
  });

  it('names a split after its fields', () => {
    const defs = splitFields({} as any);
    expect(splitLabel('genre+herkunftsregion', defs)).toBe('Genre & Region of origin');
    expect(splitLabel('herkunftsregion', defs)).toBe('Region of origin');
  });

  it('lists different values once, in order, and cuts long lists', () => {
    expect(distinctValues([aachen, utrecht, aachen2], 'gattung1')).toEqual(['Antiphon', 'Responsorium']);
    expect(joinValues(['a', 'b', 'c'], 5)).toBe('a, b, c');
    expect(joinValues(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toBe('a, b, c, …');
  });
});

describe('print placeholder lookup', () => {
  const now = new Date(2026, 9, 15);
  const settings = { customDocumentFields: [{ key: 'bearbeiter', label: 'Editor' }] } as any;

  it('gives the shared value when all documents agree, with the example of the cover', () => {
    const l = makeLookup([aachen, aachen2], settings, [], { now });
    expect(l('gattung1')).toBe('Antiphon');
    expect(l('quelle')).toBe('Aachen, Domarchiv, Hs. G 13');
    expect(l('quellenid')).toBe('Aachen, Domarchiv, Hs. G 13');
    expect(l('anzahl')).toBe('2');
    expect(l('quellenanzahl')).toBe('1');
    expect(l('jahr')).toBe('2026');
  });

  it('puts different values side by side; manuscripts are separated by semicolons', () => {
    const l = makeLookup([aachen, utrecht], settings, [], { now });
    expect(l('gattung1')).toBe('Antiphon, Responsorium');
    expect(l('quelle')).toBe('Aachen, Domarchiv, Hs. G 13; Utrecht, UB, Ms. 417');
    expect(l('quellenanzahl')).toBe('2');
  });

  it('knows English names, custom fields, the dialog title and the volume', () => {
    const l = makeLookup([utrecht], settings, [], { now, titel: ' Mein Band ', gruppe: 'Niederlande', gruppenfeld: 'Region of origin' });
    expect(l('title')).toBe('Mein Band');
    expect(l('group')).toBe('Niederlande');
    expect(l('groupfield')).toBe('Region of origin');
    expect(l('count')).toBe('1');
    expect(l('bearbeiter')).toBe('N. N.');
    expect(l('region')).toBe('Niederlande');
  });

  it('gives the values of a combined split apart as gruppe1 and gruppe2', () => {
    const l = makeLookup([aachen], settings, [], { now, gruppe: 'Antiphon · Rheinland', gruppenteile: ['Antiphon', 'Rheinland'] });
    expect(l('gruppe1')).toBe('Antiphon');
    expect(l('gruppe2')).toBe('Rheinland');
    // a split by one field: gruppe1 is the value, gruppe2 is empty
    const one = makeLookup([aachen], settings, [], { now, gruppe: 'Rheinland' });
    expect(one('gruppe1')).toBe('Rheinland');
    expect(one('gruppe2')).toBe('');
  });

  it('own variables fill in, but a field of the data wins', () => {
    const vars = [{ key: 'Herausgeber', value: 'Isabel Kraft' }, { key: 'gattung1', value: 'Nope' }];
    const l = makeLookup([aachen], settings, vars, { now });
    expect(l('herausgeber')).toBe('Isabel Kraft');
    expect(l('gattung1')).toBe('Antiphon');
  });

  it('a known field without a value is empty, an unknown name is undefined', () => {
    const l = makeLookup([job({})], settings, [], { now });
    expect(l('herkunftsregion')).toBe('');
    expect(l('titel')).toBe('');
    expect(l('gibtsnicht')).toBeUndefined();
  });
});
