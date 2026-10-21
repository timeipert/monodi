import type { Document, Source } from './api.service';
import { SigleData, planSigleChange, relabelSigle, siglumRenames } from './source-sigle';

const source = (id: string, sigle: string, more: Partial<Source> & { [key: string]: unknown } = {}): Source => ({
  id, quellensigle: sigle, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '',
  bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...more,
} as Source);

const doc = (id: string, quelle_id: string, dokumenten_id = id, more: Partial<Document> = {}): Document => ({
  id, quelle_id, dokumenten_id, gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: '', bibliographischerverweis: '',
  druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '', ...more,
} as Document);

const data = (sources: Source[], documents: Document[] = [], settings: SigleData['settings'] = null): SigleData => ({ sources, documents, settings });
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('Renaming a siglum', () => {
  const A = () => [source('a', 'Aa 13'), source('b', 'Bb 7')];
  const DOCS = () => [doc('d1', 'a', 'Aa 13-1'), doc('d2', 'a', 'Aa 13-2'), doc('d3', 'a', 'X-3'), doc('d4', 'b', 'Bb 7-1')];

  it('changes only the siglum of that source and leaves every document where it is', () => {
    const { plan, outcome } = planSigleChange(data(A(), DOCS()), { sourceId: 'a', newSigle: 'Aa13' });
    expect(plan.kind).toBe('rename');
    expect(plan.problems).toEqual([]);
    expect(outcome!.sources.map((s) => s.quellensigle)).toEqual(['Aa13', 'Bb 7']);
    expect(outcome!.documents).toBeNull();
    expect(outcome!.dirtyIds).toEqual(['a']);
    expect(outcome!.deletedId).toBeNull();
  });

  it('trims the new siglum, and takes a change of case or spacing for a rename', () => {
    const { plan, outcome } = planSigleChange(data(A()), { sourceId: 'a', newSigle: '  aa 13 ' });
    expect(plan.kind).toBe('rename');
    expect(outcome!.sources[0].quellensigle).toBe('aa 13');
  });

  it('refuses an empty siglum, a missing source and says there is nothing to do for the same siglum', () => {
    expect(planSigleChange(data(A()), { sourceId: 'a', newSigle: '   ' }).plan.problems.length).toBe(1);
    expect(planSigleChange(data(A()), { sourceId: 'zz', newSigle: 'Q' }).plan.problems.length).toBe(1);
    const same = planSigleChange(data(A()), { sourceId: 'a', newSigle: 'Aa 13' });
    expect(same.plan.kind).toBe('none');
    expect(same.plan.problems).toEqual([]);
    expect(same.outcome).toBeNull();
  });

  it('counts the document IDs that start with the old siglum, and does not touch them', () => {
    const { plan, outcome } = planSigleChange(data(A(), DOCS()), { sourceId: 'a', newSigle: 'Aa13' });
    expect(plan.idsWithOldSigle).toBe(2);
    expect(plan.documents.kept).toBe(3);
    expect(outcome!.documents).toBeNull();
  });

  it('does not change the data it was given', () => {
    const d = data(A(), DOCS(), { quellensigle: ['Aa 13'] });
    const before = copy(d);
    planSigleChange(d, { sourceId: 'a', newSigle: 'Aa13' });
    expect(d).toEqual(before);
  });

  describe('in the settings', () => {
    const SETTINGS = () => ({
      quellensigle: ['Aa 13', 'Bb 7'],
      meiProfiles: [{ id: 'p', patternRules: [
        { id: 'r1', pattern: '*u', sigle: 'Aa 13', enabled: true, nc: [] },
        { id: 'r2', pattern: '*u', sigle: 'Bb 7', enabled: true, nc: [] },
        { id: 'r3', pattern: '*u', enabled: true, nc: [] },
      ] }],
      volumeRules: [
        { name: 'North', field: 'quelle-id', op: 'in', values: ['Aa 13', 'Cc 1'] },
        { name: 'Genre', field: 'genre', op: 'in', values: ['Aa 13'] },
      ],
      pdfScale: 0.4,
    }) as any;

    it('follows in the list of sigla, the MEI rules of that manuscript and the volume rules that name manuscripts', () => {
      const { plan, outcome } = planSigleChange(data(A(), [], SETTINGS()), { sourceId: 'a', newSigle: 'Aa13' });
      const s = outcome!.settings as any;
      expect(s.quellensigle).toEqual(['Aa13', 'Bb 7']);
      expect(s.meiProfiles[0].patternRules.map((r: any) => r.sigle)).toEqual(['Aa13', 'Bb 7', undefined]);
      expect(s.volumeRules[0].values).toEqual(['Aa13', 'Cc 1']);
      expect(plan.settings).toEqual({ siglumList: true, meiRulesMoved: 1, meiRulesDropped: 0, volumeRules: 1 });
    });

    it('does not turn a genre value that happens to look like the siglum into a new siglum', () => {
      const { outcome } = planSigleChange(data(A(), [], SETTINGS()), { sourceId: 'a', newSigle: 'Aa13' });
      expect((outcome!.settings as any).volumeRules[1].values).toEqual(['Aa 13']);
      expect((outcome!.settings as any).pdfScale).toBe(0.4);
    });

    it('stores no settings when they repeat nothing', () => {
      const { outcome } = planSigleChange(data(A(), [], { pdfScale: 1 } as any), { sourceId: 'a', newSigle: 'Aa13' });
      expect(outcome!.settings).toBeNull();
    });

    it('lets the renamed manuscript\'s MEI rule win over a leftover one for the new siglum', () => {
      const s = { meiProfiles: [{ id: 'p', patternRules: [
        { id: 'old', pattern: '*u', sigle: 'Aa 13', enabled: true, nc: [{ x: 'a' }] },
        { id: 'stale', pattern: '*u', sigle: 'Aa13', enabled: true, nc: [{ x: 'b' }] },
      ] }] } as any;
      const { plan, outcome } = planSigleChange(data(A(), [], s), { sourceId: 'a', newSigle: 'Aa13' });
      expect((outcome!.settings as any).meiProfiles[0].patternRules.map((r: any) => r.id)).toEqual(['old']);
      expect(plan.settings.meiRulesDropped).toBe(1);
    });
  });
});

describe('Merging two sources by siglum', () => {
  const SRC = () => [
    source('a', 'Aa 13', { herkunftsort: 'Aachen', bibliothek: 'Domarchiv', custom: { description: 'About A' } }),
    source('b', 'Bb 7', { herkunftsort: 'Bonn', bibliothek: '', datierung: '12th c.', assignedTo: ['tim'], custom: { description: 'About B', extra: 'x' } } as any),
    source('c', 'Cc 1'),
  ];
  const DOCS = () => [doc('d1', 'a', 'A-1'), doc('d2', 'a', 'A-2'), doc('d3', 'b', 'B-1'), doc('d4', 'b', 'B-2'), doc('d5', 'c', 'C-1')];

  it('is a merge when the new siglum belongs to another source, whatever its case or spacing', () => {
    const { plan } = planSigleChange(data(SRC(), DOCS()), { sourceId: 'b', newSigle: ' aa 13' });
    expect(plan.kind).toBe('merge');
    expect(plan.keepId).toBe('a');
    expect(plan.dropId).toBe('b');
    expect(plan.newSigle).toBe('Aa 13');
  });

  it('moves the documents of the absorbed source over, removes it and marks the one that stays for upload and the other for deletion', () => {
    const { plan, outcome } = planSigleChange(data(SRC(), DOCS()), { sourceId: 'b', newSigle: 'Aa 13' });
    expect(plan.documents).toEqual(jasmine.objectContaining({ moved: 2, kept: 2, duplicates: 0 }));
    expect(outcome!.sources.map((s) => s.id)).toEqual(['a', 'c']);
    expect(outcome!.documents!.map((d) => [d.id, d.quelle_id])).toEqual([['d1', 'a'], ['d2', 'a'], ['d3', 'a'], ['d4', 'a'], ['d5', 'c']]);
    expect(outcome!.dirtyIds).toEqual(['a']);
    expect(outcome!.deletedId).toBe('b');
  });

  it('loses no document', () => {
    const { outcome } = planSigleChange(data(SRC(), DOCS()), { sourceId: 'b', newSigle: 'Aa 13' });
    expect(outcome!.documents!.map((d) => d.id).sort()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
  });

  it('fills what the stayed source lacks from the absorbed one, and asks about what differs', () => {
    const { plan, outcome } = planSigleChange(data(SRC(), DOCS()), { sourceId: 'b', newSigle: 'Aa 13' });
    const merged: any = outcome!.sources[0];
    expect(merged.datierung).toBe('12th c.');                       // only B knew it
    expect(merged.assignedTo).toEqual(['tim']);
    expect(merged.custom.extra).toBe('x');
    expect(merged.herkunftsort).toBe('Aachen');                     // differs: the stayed source's, until chosen otherwise
    expect(plan.conflicts.map((c) => c.key)).toEqual(['herkunftsort', 'custom.description']);
    expect(plan.conflicts[0]).toEqual(jasmine.objectContaining({ kept: 'Aachen', other: 'Bonn', choice: 'kept', canJoin: false }));
  });

  it('takes the absorbed value, or both for text, as chosen', () => {
    const { outcome } = planSigleChange(data(SRC(), DOCS()), { sourceId: 'b', newSigle: 'Aa 13', choices: { herkunftsort: 'other', 'custom.description': 'both' } });
    const merged: any = outcome!.sources[0];
    expect(merged.herkunftsort).toBe('Bonn');
    expect(merged.custom.description).toBe('About A\n\nAbout B');
  });

  it('does not join values that are not text (a place cannot be "both")', () => {
    const { plan, outcome } = planSigleChange(data(SRC(), DOCS()), { sourceId: 'b', newSigle: 'Aa 13', choices: { herkunftsort: 'both' } });
    expect((outcome!.sources[0] as any).herkunftsort).toBe('Aachen');
    expect(plan.conflicts[0].choice).toBe('kept');
  });

  it('reads the old key of the description as the description', () => {
    const src = [source('a', 'A', { custom: { description: 'new' } }), source('b', 'B', { custom: { beschreibung: 'old' } })];
    const { plan, outcome } = planSigleChange(data(src), { sourceId: 'b', newSigle: 'A' });
    expect(plan.conflicts.map((c) => c.key)).toEqual(['custom.description']);
    expect((outcome!.sources[0] as any).custom.beschreibung).toBeUndefined();
  });

  it('keeps a document that is in both with identical content once', () => {
    const docs = [doc('d1', 'a', 'A-1'), doc('d1', 'b', 'A-1'), doc('d2', 'b', 'B-2')];
    const { plan, outcome } = planSigleChange(data(SRC(), docs), { sourceId: 'b', newSigle: 'Aa 13' });
    expect(plan.documents).toEqual(jasmine.objectContaining({ duplicates: 1, moved: 1 }));
    expect(outcome!.documents!.map((d) => [d.id, d.quelle_id])).toEqual([['d1', 'a'], ['d2', 'a']]);
  });

  it('refuses to merge when the same document is in both with different content', () => {
    const docs = [doc('d1', 'a', 'A-1', { textinitium: 'one' }), doc('d1', 'b', 'A-1', { textinitium: 'two' })];
    const { plan, outcome } = planSigleChange(data(SRC(), docs), { sourceId: 'b', newSigle: 'Aa 13' });
    expect(plan.problems.length).toBe(1);
    expect(outcome).toBeNull();
  });

  it('lists the document IDs used in both sources, but does not stop for them', () => {
    const docs = [doc('d1', 'a', 'GL-01'), doc('d2', 'a', 'GL-02'), doc('d3', 'b', 'GL-02'), doc('d4', 'b', 'GL-09')];
    const { plan, outcome } = planSigleChange(data(SRC(), docs), { sourceId: 'b', newSigle: 'Aa 13' });
    expect(plan.documents.clashingIds).toEqual(['GL-02']);
    expect(plan.documents.clashingIdsTotal).toBe(1);
    expect(plan.problems).toEqual([]);
    expect(outcome!.documents!.length).toBe(4);
  });

  it('adds annotations by id, and refuses the same id with different content', () => {
    const region = (id: string, name: string) => ({ id, name, points: '', folio: '1' });
    const a = source('a', 'A', { annotationRegions: [region('r1', 'x')] } as any);
    const ok = planSigleChange(data([a, source('b', 'B', { annotationRegions: [region('r1', 'x'), region('r2', 'y')] } as any)]), { sourceId: 'b', newSigle: 'A' });
    expect((ok.outcome!.sources[0] as any).annotationRegions.map((r: any) => r.id)).toEqual(['r1', 'r2']);
    expect(ok.plan.annotationsTaken).toBe(1);
    const clash = planSigleChange(data([a, source('b', 'B', { annotationRegions: [region('r1', 'other')] } as any)]), { sourceId: 'b', newSigle: 'A' });
    expect(clash.plan.problems.length).toBe(1);
    expect(clash.outcome).toBeNull();
  });

  it('asks about an equivalent that has another reference ID in the other source', () => {
    const a = source('a', 'A', { equivalents: [{ pattern: '*u', refId: '1' }] } as any);
    const b = source('b', 'B', { equivalents: [{ pattern: '*u', refId: '2' }, { pattern: '*d', refId: '3' }] } as any);
    const { plan, outcome } = planSigleChange(data([a, b]), { sourceId: 'b', newSigle: 'A', choices: { 'equivalent:*u': 'other' } });
    expect(plan.conflicts.map((c) => c.key)).toEqual(['equivalent:*u']);
    expect((outcome!.sources[0] as any).equivalents).toEqual([{ pattern: '*u', refId: '2' }, { pattern: '*d', refId: '3' }]);
  });

  it('does not guess when several sources have the new siglum', () => {
    const src = [source('a', 'X'), source('b', 'x'), source('c', 'C')];
    const { plan, outcome } = planSigleChange(data(src), { sourceId: 'c', newSigle: 'X' });
    expect(plan.problems.length).toBe(1);
    expect(outcome).toBeNull();
  });

  it('merges the settings: the old siglum leaves the list, its MEI rules go to the stayed one unless that has one for the same neume', () => {
    const settings = {
      quellensigle: ['Aa 13', 'Bb 7'],
      meiProfiles: [{ id: 'p', patternRules: [
        { id: 'ra', pattern: '*u', sigle: 'Aa 13', enabled: true, nc: [] },
        { id: 'rb1', pattern: '*u', sigle: 'Bb 7', enabled: true, nc: [] },
        { id: 'rb2', pattern: '*d', sigle: 'Bb 7', enabled: true, nc: [] },
      ] }],
      volumeRules: [{ name: 'V', field: 'quellensigle', op: 'in', values: ['Aa 13', 'Bb 7'] }],
    } as any;
    const { plan, outcome } = planSigleChange(data(SRC(), DOCS(), settings), { sourceId: 'b', newSigle: 'Aa 13' });
    const s = outcome!.settings as any;
    expect(s.quellensigle).toEqual(['Aa 13']);
    expect(s.meiProfiles[0].patternRules.map((r: any) => [r.id, r.sigle])).toEqual([['ra', 'Aa 13'], ['rb2', 'Aa 13']]);
    expect(s.volumeRules[0].values).toEqual(['Aa 13']);
    expect(plan.settings).toEqual({ siglumList: true, meiRulesMoved: 1, meiRulesDropped: 1, volumeRules: 1 });
  });

  it('does not change the data it was given', () => {
    const d = data(SRC(), DOCS(), { quellensigle: ['Aa 13', 'Bb 7'] });
    const before = copy(d);
    planSigleChange(d, { sourceId: 'b', newSigle: 'Aa 13', choices: { herkunftsort: 'other' } });
    expect(d).toEqual(before);
  });
});

describe('relabelSigle', () => {
  it('returns the same settings object when nothing repeats the siglum', () => {
    const s = { quellensigle: ['A'] } as any;
    expect(relabelSigle(s, 'Q', 'R', 'from').settings).toBe(s);
    expect(relabelSigle(null, 'Q', 'R', 'from').settings).toBeNull();
  });
});

describe('siglumRenames', () => {
  it('lists the sources whose siglum differs, by id', () => {
    const before = [source('a', 'A'), source('b', 'B'), source('c', '')];
    const after = [source('a', 'A2'), source('b', 'B'), source('c', 'C')];
    expect(siglumRenames(before, after)).toEqual([{ from: 'A', to: 'A2' }]);
  });
});
