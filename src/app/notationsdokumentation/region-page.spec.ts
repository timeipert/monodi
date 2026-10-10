import {
  backfillRegionPages, canvasIdOf, canvasImageIdOf, canvasLabelOf, folioMatches, pageImageOf, pageLabelOf, regionCanvasIndex, regionOnCanvas, stampRegionPage
} from './region-page';

// v2-shaped canvases (@id, string label) and v3-shaped (id, language-map label)
const v2 = [
  { '@id': 'https://x/c/0', label: 'Cover' },
  { '@id': 'https://x/c/1', label: '1r' },
  { '@id': 'https://x/c/2', label: '1v' },
  { '@id': 'https://x/c/3', label: 'fol. 2' }
];
const v3 = [
  { id: 'https://y/c/0', label: { none: ['113r'] }, items: [{ items: [{ body: { service: [{ id: 'https://img.y/iiif/113r/' }] } }] }] },
  { id: 'https://y/c/1', label: { en: ['113v'] }, items: [{ items: [{ body: { service: [{ '@id': 'https://img.y/iiif/113v' }] } }] }] }
];
const v2WithImages = [
  { '@id': 'https://z/c/0', label: 'a', images: [{ resource: { service: { '@id': 'https://img.z/iiif/a' } } }] },
  { '@id': 'https://z/c/1', label: 'b', images: [{ resource: { service: { '@id': 'https://img.z/iiif/b' } } }] }
];

describe('region-page', () => {
  it('reads canvas ids and labels from IIIF v2 and v3', () => {
    expect(canvasIdOf(v2[1])).toBe('https://x/c/1');
    expect(canvasIdOf(v3[0])).toBe('https://y/c/0');
    expect(canvasLabelOf(v2[1])).toBe('1r');
    expect(canvasLabelOf(v3[1])).toBe('113v');
    expect(canvasLabelOf({ label: [{ '@value': 'x' }] })).toBe('x');
    expect(canvasLabelOf({})).toBe('');
  });

  it('reads the image service of a canvas, v2 and v3, without a trailing slash', () => {
    expect(canvasImageIdOf(v3[0])).toBe('https://img.y/iiif/113r');
    expect(canvasImageIdOf(v3[1])).toBe('https://img.y/iiif/113v');
    expect(canvasImageIdOf(v2WithImages[1])).toBe('https://img.z/iiif/b');
    expect(canvasImageIdOf(v2[0])).toBeUndefined();
  });

  it('places a region by its image when there is no canvas id (a page the Neumen-Editor took from the corpus)', () => {
    expect(regionCanvasIndex({ folio: '99', imageId: 'https://img.z/iiif/b/' }, v2WithImages)).toBe(1);
    expect(regionCanvasIndex({ folio: '0', canvasId: 'https://z/c/0', imageId: 'https://img.z/iiif/b' }, v2WithImages)).toBe(0); // canvas id first
    expect(regionCanvasIndex({ folio: 'x', imageId: 'https://img.z/iiif/zzz', folioLabel: 'b' }, v2WithImages)).toBe(1); // falls on to the label
  });

  it('matches folios loosely', () => {
    expect(folioMatches('fol. 1r', '1 recto')).toBeTrue();
    expect(folioMatches('2', '2r')).toBeTrue();
    expect(folioMatches('2v', '2')).toBeFalse();
  });

  describe('regionCanvasIndex', () => {
    it('prefers the canvas id over everything else', () => {
      expect(regionCanvasIndex({ folio: '1', canvasId: 'https://x/c/2', folioLabel: '1r' }, v2)).toBe(2);
    });

    it('survives a reordered manifest when the canvas id is present', () => {
      const reordered = [v2[3], v2[2], v2[1], v2[0]];
      expect(regionCanvasIndex({ folio: '1', canvasId: 'https://x/c/1' }, reordered)).toBe(2);
    });

    it('falls back to the label, then the legacy index', () => {
      expect(regionCanvasIndex({ folio: '9', folioLabel: '1v' }, v2)).toBe(2);
      expect(regionCanvasIndex({ folio: '2' }, v2)).toBe(2);
    });

    it('reads a folio label in the legacy field (what the Neume Viewer used to write)', () => {
      expect(regionCanvasIndex({ folio: '113v' }, v3)).toBe(1);
      expect(regionCanvasIndex({ folio: '2r' }, v2)).toBe(3); // "fol. 2" ~ 2r
    });

    it('does not read "113r" as canvas 113', () => {
      expect(regionCanvasIndex({ folio: '113r' }, v2)).toBeNull();
    });

    it('returns null when the page cannot be placed', () => {
      expect(regionCanvasIndex({ folio: '99' }, v2)).toBeNull();
      expect(regionCanvasIndex({ folio: '' }, v2)).toBeNull();
      expect(regionCanvasIndex({ folio: '0' }, [])).toBeNull();
    });
  });

  it('regionOnCanvas agrees with regionCanvasIndex', () => {
    const r = { folio: '2', canvasId: 'https://x/c/2' };
    expect(regionOnCanvas(r, v2, 2)).toBeTrue();
    expect(regionOnCanvas(r, v2, 1)).toBeFalse();
    expect(regionOnCanvas({ folio: '1v' }, v2, 2)).toBeTrue();
  });

  it('stamps index, canvas id and label together', () => {
    const r = { folio: '', canvasId: undefined as string | undefined, folioLabel: undefined as string | undefined };
    stampRegionPage(r, v2, 1);
    expect(r).toEqual({ folio: '1', canvasId: 'https://x/c/1', folioLabel: '1r' });
  });

  describe('backfillRegionPages', () => {
    it('adds the canvas id to legacy-index regions without touching folio', () => {
      const regions = [{ folio: '2' } as any];
      expect(backfillRegionPages(regions, v2)).toBe(1);
      expect(regions[0]).toEqual({ folio: '2', canvasId: 'https://x/c/2', folioLabel: '1v' });
    });

    it('keeps a label another app wrote and does not rewrite its folio', () => {
      const regions = [{ folio: '113r', folioLabel: '113r' } as any];
      expect(backfillRegionPages(regions, v3)).toBe(1);
      expect(regions[0]).toEqual({ folio: '113r', folioLabel: '113r', canvasId: 'https://y/c/0' });
    });

    it('leaves stamped and unplaceable regions alone', () => {
      const regions = [{ folio: '1', canvasId: 'https://x/c/1' } as any, { folio: '99' } as any];
      expect(backfillRegionPages(regions, v2)).toBe(0);
      expect(regions[1]).toEqual({ folio: '99' });
    });
  });

  describe('pageImageOf', () => {
    const sized = [{ '@id': 'https://s/c/0', label: 'p1', width: 3000, height: 4000, images: [{ resource: { '@id': 'https://s/full.jpg', service: { '@id': 'https://img.s/iiif/p1' } } }] },
                   { '@id': 'https://s/c/1', label: 'p2', images: [{ resource: { '@id': 'https://s/p2.jpg' } }] }];

    it('uses the region\'s own image id, with the page size if the manifest knows the canvas', () => {
      expect(pageImageOf({ folio: '0', canvasId: 'https://s/c/0', imageId: 'https://other/iiif/x/' }, sized)).toEqual({ base: 'https://other/iiif/x', w: 3000, h: 4000 });
      expect(pageImageOf({ folio: '', imageId: 'https://other/iiif/x' }, [])).toEqual({ base: 'https://other/iiif/x', w: undefined, h: undefined });
    });

    it('otherwise takes the image service of the canvas it resolves to', () => {
      expect(pageImageOf({ folio: '0' }, sized)).toEqual({ base: 'https://img.s/iiif/p1', url: 'https://s/full.jpg', w: 3000, h: 4000 });
    });

    it('falls back to the plain image of a canvas with no service', () => {
      expect(pageImageOf({ folio: '1' }, sized)).toEqual({ base: undefined, url: 'https://s/p2.jpg', w: undefined, h: undefined });
    });

    it('is null for a region that cannot be placed', () => {
      expect(pageImageOf({ folio: '99' }, sized)).toBeNull();
    });
  });

  describe('pageLabelOf', () => {
    it('prefers the label the writer knew, then the manifest\'s label, then the position', () => {
      expect(pageLabelOf({ folio: '1', folioLabel: '113r' }, v2)).toBe('113r');
      expect(pageLabelOf({ folio: '1' }, v2)).toBe('1r');
      expect(pageLabelOf({ folio: '1' }, [{ '@id': 'x' }, { '@id': 'y' }])).toBe('page 2');
      expect(pageLabelOf({ folio: '12r' }, [])).toBe('12r');
      expect(pageLabelOf({ folio: '7' }, [])).toBe('');
    });
  });
});
