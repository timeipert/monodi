import { Source } from './api.service';
import { applyPlan, describePlan, EXCHANGE_FORMAT, matchSource, parseExchange, planChangesAnything, planImport, planMerge } from './annotation-exchange';

const source = (extra: Partial<Source> = {}): Source => ({
  id: 'src-1', quellensigle: 'Aa 1', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
  quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...extra
});

describe('annotation exchange (from the Neumen-Editor)', () => {
  describe('parseExchange', () => {
    it('reads its own format', () => {
      const f = parseExchange(JSON.stringify({ format: EXCHANGE_FORMAT, version: 1, sources: [{ id: 'a' }] }));
      expect(f.sources.length).toBe(1);
    });
    it('refuses another file, and a newer one', () => {
      expect(() => parseExchange({ sources: [] })).toThrowError(/not an annotation file/);
      expect(() => parseExchange({ format: EXCHANGE_FORMAT, version: 99, sources: [] })).toThrowError(/newer version/);
    });
    it('treats missing sources as none', () => {
      expect(parseExchange({ format: EXCHANGE_FORMAT, version: 1 }).sources).toEqual([]);
    });
  });

  describe('matchSource', () => {
    const locals = [source({ id: 'one', quellensigle: 'Aa 1' }), source({ id: 'two', quellensigle: 'Bb 2' })];
    it('prefers the id, which survives a renamed siglum', () => {
      expect(matchSource({ id: 'two', quellensigle: 'Aa 1' }, locals)!.id).toBe('two');
    });
    it('falls back to the siglum', () => {
      expect(matchSource({ id: 'unknown', quellensigle: 'Bb 2' }, locals)!.id).toBe('two');
      expect(matchSource({ quellensigle: 'Aa 1' }, locals)!.id).toBe('one');
    });
    it('finds nothing for a source that is not here', () => {
      expect(matchSource({ id: 'x', quellensigle: 'Zz 9' }, locals)).toBeNull();
    });
    it('reads a siglum that is a list', () => {
      expect(matchSource({ quellensigle: ['Aa', '1'] }, [source({ id: 'l', quellensigle: ['Aa', '1'] as any })])!.id).toBe('l');
    });
  });

  describe('planMerge', () => {
    const region = { id: 'r1', name: 'Line 1', points: '0,0 10,0 10,5 0,5', folio: '0' };
    const item = { id: 'i1', regionId: 'r1', pattern: '*u', points: '1,1 2,1 2,2 1,2' };

    it('adds what is new, keeping the page fields', () => {
      const plan = planMerge(source(), {
        annotationRegions: [{ ...region, folio: '119r', folioLabel: '119r', canvasId: 'https://m/c/3', imageId: 'https://img/3', lineUUID: 'lc-1' }],
        annotationItems: [{ ...item, variant: 'b', uuid: 'n-1' }],
        equivalents: [{ pattern: '*u', refId: '12', notes: 'rising' }],
        iiifManifestUrl: 'https://m/manifest.json'
      });
      expect(plan.counts).toEqual(jasmine.objectContaining({
        regionsNew: 1, itemsNew: 1, equivalentsNew: 1, manifestSet: true, regionsUpdated: 0, itemsDropped: 0
      }));
      expect(plan.result.annotationRegions![0]).toEqual({
        id: 'r1', name: 'Line 1', points: '0,0 10,0 10,5 0,5', folio: '119r', folioLabel: '119r', canvasId: 'https://m/c/3', imageId: 'https://img/3', lineUUID: 'lc-1'
      });
      expect(plan.result.annotationItems![0]).toEqual(jasmine.objectContaining({ id: 'i1', regionId: 'r1', variant: 'b', uuid: 'n-1' }));
      expect(plan.result.equivalents).toEqual([{ pattern: '*u', refId: '12', notes: 'rising' }]);
      expect(plan.result.iiifManifestUrl).toBe('https://m/manifest.json');
    });

    it('lets the editor\'s geometry, names, patterns and ids win', () => {
      const local = source({
        annotationRegions: [{ ...region, name: 'old', points: 'old' }],
        annotationItems: [{ ...item, pattern: '*d', variant: 'a' }],
        equivalents: [{ pattern: '*u', refId: '1', notes: 'mine' }]
      });
      const plan = planMerge(local, {
        annotationRegions: [region],
        annotationItems: [{ ...item, variant: 'b' }],
        equivalents: [{ pattern: '*u', refId: '12' }]
      });
      expect(plan.counts).toEqual(jasmine.objectContaining({ regionsUpdated: 1, itemsUpdated: 1, equivalentsUpdated: 1, regionsNew: 0 }));
      expect(plan.result.annotationRegions![0].name).toBe('Line 1');
      expect(plan.result.annotationItems![0]).toEqual(jasmine.objectContaining({ pattern: '*u', variant: 'b' }));
      expect(plan.result.equivalents![0]).toEqual({ pattern: '*u', refId: '12', notes: 'mine' }); // the file had no note: keep mine
    });

    it('never blanks a link to the transcription, and takes one when the file has it', () => {
      const local = source({
        annotationRegions: [{ ...region, lineUUID: 'mine-line' }],
        annotationItems: [{ ...item, uuid: 'mine-note' }]
      });
      const keep = planMerge(local, { annotationRegions: [region], annotationItems: [item] });
      expect(keep.result.annotationRegions![0].lineUUID).toBe('mine-line');
      expect(keep.result.annotationItems![0].uuid).toBe('mine-note');
      expect(planChangesAnything(keep)).toBe(false);

      const take = planMerge(source({ annotationRegions: [region], annotationItems: [item] }),
        { annotationRegions: [{ ...region, lineUUID: 'from-editor' }], annotationItems: [{ ...item, uuid: 'n-9' }] });
      expect(take.result.annotationRegions![0].lineUUID).toBe('from-editor');
      expect(take.result.annotationItems![0].uuid).toBe('n-9');
      expect(take.counts).toEqual(jasmine.objectContaining({ regionsUpdated: 1, itemsUpdated: 1 }));
    });

    it('may clear a variant, because "no variant" is a statement', () => {
      const plan = planMerge(source({ annotationRegions: [region], annotationItems: [{ ...item, variant: 'a' }] }),
        { annotationItems: [{ ...item, variant: '' }] });
      expect(plan.result.annotationItems![0].variant).toBeUndefined();
      expect(plan.counts.itemsUpdated).toBe(1);
    });

    it('deletes nothing: what is only here stays', () => {
      const local = source({
        annotationRegions: [{ id: 'only-here', name: 'Line 9', points: 'p', folio: '1' }],
        annotationItems: [{ id: 'item-here', regionId: 'only-here', pattern: '*', points: 'p' }],
        equivalents: [{ pattern: '*dd', refId: '4' }]
      });
      const plan = planMerge(local, { annotationRegions: [region], annotationItems: [item], equivalents: [] });
      expect(plan.result.annotationRegions!.map(r => r.id)).toEqual(['only-here', 'r1']);
      expect(plan.result.annotationItems!.map(i => i.id)).toEqual(['item-here', 'i1']);
      expect(plan.result.equivalents).toEqual([{ pattern: '*dd', refId: '4' }]);
    });

    it('drops a snippet whose line region is nowhere, and says so', () => {
      const plan = planMerge(source(), { annotationItems: [{ ...item, regionId: 'ghost' }] });
      expect(plan.counts.itemsDropped).toBe(1);
      expect(plan.result.annotationItems).toEqual([]);
    });

    it('takes a snippet for a region that is already here', () => {
      const plan = planMerge(source({ annotationRegions: [region] }), { annotationItems: [item] });
      expect(plan.counts.itemsNew).toBe(1);
    });

    it('keeps the manifest address the source has', () => {
      const plan = planMerge(source({ iiifManifestUrl: 'https://mine' }), { iiifManifestUrl: 'https://theirs' });
      expect(plan.result.iiifManifestUrl).toBe('https://mine');
      expect(plan.counts.manifestSet).toBe(false);
    });

    it('does not change the source it was given', () => {
      const local = source({ annotationRegions: [{ ...region }], annotationItems: [{ ...item }], equivalents: [{ pattern: '*u', refId: '1' }] });
      const before = JSON.stringify(local);
      planMerge(local, { annotationRegions: [{ ...region, name: 'new' }], annotationItems: [{ ...item, pattern: '*d' }], equivalents: [{ pattern: '*u', refId: '2' }] });
      expect(JSON.stringify(local)).toBe(before);
    });

    it('is a no-op the second time', () => {
      const incoming = { annotationRegions: [region], annotationItems: [item], equivalents: [{ pattern: '*u', refId: '3' }] };
      const once = applyPlan(source(), planMerge(source(), incoming));
      expect(planChangesAnything(planMerge(once, incoming))).toBe(false);
    });
  });

  describe('describePlan', () => {
    it('reads as a list, with no trailing separator', () => {
      const plan = planMerge(source(), {
        annotationRegions: [{ id: 'r1', name: 'L', points: 'p', folio: '1' }],
        annotationItems: [{ id: 'i1', regionId: 'r1', pattern: '*', points: 'p' }, { id: 'i2', regionId: 'r1', pattern: '*u', points: 'p' }],
        equivalents: [{ pattern: '*', refId: '1' }]
      });
      expect(describePlan(plan)).toBe('1 new line region, 2 new snippets, 1 new table row');
    });
    it('is empty when there is nothing to do', () => {
      expect(describePlan(planMerge(source(), {}))).toBe('');
    });
  });

  describe('planImport', () => {
    it('plans each matched source and reports the others', () => {
      const locals = [source({ id: 'one', quellensigle: 'Aa 1' })];
      const preview = planImport(parseExchange({
        format: EXCHANGE_FORMAT, version: 1,
        sources: [{ id: 'one', equivalents: [{ pattern: '*', refId: '1' }] }, { id: 'x', quellensigle: 'Zz 9' }, { id: 'one' }]
      }), locals);
      expect(preview.plans.map(p => p.sourceId)).toEqual(['one']);
      expect(preview.unmatched).toEqual(['Zz 9']);
    });
  });

  // The file the Neumen-Editor actually wrote in its end-to-end check (a region Monodi gave
  // a lineUUID, a snippet Monodi linked, and one the editor linked by sysId).
  describe('a file as the Neumen-Editor writes it', () => {
    const file = {
      format: 'cm-annotation-exchange', version: 1, generator: 'neumen-editor', exportedAt: '2026-10-04T21:03:52.067Z',
      sources: [{
        id: 'AugW 13', quellensigle: 'AugW 13',
        equivalents: [{ pattern: '*', refId: '1', notes: 'from monodi' }],
        annotationRegions: [{ id: 'r_monodi_2', name: 'Line 8', points: '5,30 95,30 95,38 5,38', folio: '119r', folioLabel: '119r', lineUUID: 'line-from-monodi' }],
        annotationItems: [
          { id: 'item_monodi_1', regionId: 'r_monodi_2', pattern: '*', variant: '', points: '10,31 14,31 14,36 10,36', uuid: '81704f14-b596-4ca9-86dd-0c0eef7be5f7' },
          { id: '1791147811781', regionId: 'r_monodi_2', pattern: '*', variant: 'b', points: '20,31 24,31 24,36 20,36', uuid: '98c11df7-3ae9-4ac3-a0ca-fba9fb970739' }
        ]
      }]
    };

    it('matches by siglum when the source has the same id or none in the file, and applies', () => {
      const preview = planImport(parseExchange(file), [source({ id: 'AugW 13', quellensigle: 'AugW 13' })]);
      expect(preview.unmatched).toEqual([]);
      const plan = preview.plans[0];
      expect(plan.counts).toEqual(jasmine.objectContaining({ regionsNew: 1, itemsNew: 2, equivalentsNew: 1 }));
      const out = applyPlan(source({ id: 'AugW 13', quellensigle: 'AugW 13' }), plan);
      expect(out.annotationItems!.map(i => i.uuid)).toEqual(['81704f14-b596-4ca9-86dd-0c0eef7be5f7', '98c11df7-3ae9-4ac3-a0ca-fba9fb970739']);
      expect(out.annotationRegions![0].lineUUID).toBe('line-from-monodi');
      // the value the rest of the app reads for a page
      expect(out.annotationRegions![0].folioLabel).toBe('119r');
    });
  });
});
