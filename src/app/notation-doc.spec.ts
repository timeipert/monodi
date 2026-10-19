import * as VM from './types/model';
import {
  buildNotationDoc, compareFolios, compareRefIds, flowColumns, idLabel, idParts, lineNumberOf, notationNotes, placeOf, printedFolio, tonesOf
} from './notation-doc';
import { NotationSetup } from './notation-set';

const region = (id: string, folioLabel: string, line: number, points = '10,30 80,30 80,38 10,38'): VM.AnnotationRegion =>
  ({ id, name: `Line ${line}`, points, folio: '', folioLabel });
const item = (id: string, regionId: string, pattern: string, variant = '', points = '20,32 24,32 24,36 20,36'): VM.AnnotationItem =>
  ({ id, regionId, pattern, points, ...(variant ? { variant } : {}) });

describe('notation documentation', () => {
  describe('small helpers', () => {
    it('counts the notes of a pattern', () => {
      expect(tonesOf('*')).toBe(1);
      expect(tonesOf('[*u]dd')).toBe(4);
      expect(tonesOf('*SeS')).toBe(2);       // the S marks a sign, not a note
      expect(tonesOf('[*dL]')).toBe(2);
    });

    it('writes an ID as printed and in its parts', () => {
      expect(idLabel('10+/20-')).toBe('10+20-');
      expect(idLabel('20')).toBe('20');
      expect(idParts('10+/20-')).toEqual(['10+', '20-']);
      expect(idParts('20+')).toEqual(['20+']);
    });

    it('prints the recto without its letter and the verso with it', () => {
      expect(printedFolio('8r')).toBe('8');
      expect(printedFolio('44v')).toBe('44v');
      expect(printedFolio('20')).toBe('20');
      expect(printedFolio('A1r')).toBe('A1r');
    });

    it('reads the line from the region name and the page from its label', () => {
      expect(lineNumberOf({ name: 'Line 8' })).toBe(8);
      expect(lineNumberOf({ name: 'Zeile 12' })).toBe(12);
      expect(lineNumberOf({ name: 'refrain' })).toBeNull();
      expect(placeOf(region('r', '44v', 2)).text).toBe('44v / 2');
      expect(placeOf(region('r', '8r', 6)).text).toBe('8 / 6');
      // a `folio` that is all digits is a canvas index, not a page name
      expect(placeOf({ id: 'x', name: 'Line 1', points: '', folio: '7' }).text).toBe('1');
    });

    it('sorts Reference IDs: plain numbers first, then the composite ones', () => {
      const ids = ['20+', '40', '10+/40-', '', '10', '9', '10+/20-', '100'];
      expect([...ids].sort(compareRefIds)).toEqual(['9', '10', '40', '100', '10+/20-', '10+/40-', '20+', '']);   // no ID: last
    });

    it('sorts folios in book order', () => {
      expect(['45', '44v', '9v', '100', '44', '9'].sort(compareFolios)).toEqual(['9', '9v', '44', '44v', '45', '100']);
    });

    it('reads the notes text of a source', () => {
      expect(notationNotes({ custom: { notationNotes: 'Notator A' } })).toBe('Notator A');
      expect(notationNotes(null)).toBe('');
    });
  });

  describe('buildNotationDoc', () => {
    const setup: NotationSetup = {
      standard: [{ pattern: '*', refId: '10' }, { pattern: '[*du]', refId: '21' }, { pattern: '[*dL]', refId: '10+/20-' }, { pattern: '*dd', refId: '30' }],
      order: 'id',
    };
    const source: any = {
      equivalents: [
        { pattern: '*', refId: '10' },
        { pattern: '[*dL]', refId: '11+', notes: 'only in a very low position' },   // the manuscript's own ID wins
        { pattern: '*u', refId: '40' },                                             // a row of its table, no snippet
      ],
      annotationRegions: [region('r1', '45', 5), region('r2', '44v', 2), region('r3', '44v', 11)],
      annotationItems: [
        item('i1', 'r1', '*', 'a'), item('i2', 'r2', '*', 'b'), item('i3', 'r3', '*', 'a'),
        item('i4', 'r1', '[*du]'), item('i5', 'r2', '[*dL]', 'b'),
        item('i6', 'r1', '*ud'),                      // snippets of a pattern that is not in the standard set
        item('ghost', 'nowhere', '*'),                // a snippet of a region that is not there
      ],
    };
    const doc = buildNotationDoc(source, setup);

    it('shows the standard set, and what the manuscript has snippets of, in the order of the IDs', () => {
      // `*dd` has no snippet and is shown all the same; `*u` has a table row only and is not shown; `*ud` has snippets but no ID
      expect(doc.rows.map(r => r.pattern)).toEqual(['*', '[*du]', '*dd', '[*dL]', '*ud']);
      expect(doc.rows.map(r => r.refId)).toEqual(['10', '21', '30', '11+', '']);
      expect(doc.rows[3].idParts).toEqual(['11+']);
      expect(doc.withoutId).toBe(1);
    });

    it('lists the places by variant, in book order, each place once; a row without snippets has none', () => {
      const ten = doc.rows[0];
      expect(ten.variants.map(v => v.variant)).toEqual(['a', 'b']);
      expect(ten.variants[0].places.map(p => p.text)).toEqual(['44v / 11', '45 / 5']);
      expect(ten.variants[1].places.map(p => p.text)).toEqual(['44v / 2']);
      expect(doc.rows[1].variants).toEqual([{ variant: '', places: [jasmine.objectContaining({ text: '45 / 5' })] }]);
      expect(doc.rows[2].variants).toEqual([]);
    });

    it('makes a strip per line with signs, in book order, boxes left to right; a frame without an ID names the pattern', () => {
      expect(doc.strips.map(s => s.place.text)).toEqual(['44v / 2', '44v / 11', '45 / 5']);
      expect(doc.strips[2].boxes.map(b => b.label)).toEqual(['10a', '21', '*ud']);
      expect(doc.strips[0].boxes.map(b => b.label)).toEqual(['10b', '11+b']);
    });

    it('lists the notes of the table rows by their printed ID', () => {
      expect(doc.notes).toEqual([{ key: '11+', text: 'only in a very low position' }]);
    });

    it('leaves out what the manuscript removed, and counts the snippets that went with it', () => {
      const without = buildNotationDoc({ ...source, custom: { notationSet: JSON.stringify({ add: [], remove: ['*ud', '*'] }) } }, setup);
      expect(without.rows.map(r => r.pattern)).toEqual(['[*du]', '*dd', '[*dL]']);
      expect(without.excluded).toBe(4);       // three of `*` and one of `*ud`
      expect(without.strips.flatMap(s => s.boxes.map(b => b.label))).not.toContain('10a');
    });

    it('shows what the manuscript added, even without a snippet', () => {
      const more = buildNotationDoc({ ...source, custom: { notationSet: JSON.stringify({ add: ['*u'], remove: [] }) } }, setup);
      expect(more.rows.map(r => r.pattern)).toContain('*u');
      expect(more.rows.find(r => r.pattern === '*u')!.refId).toBe('40');
    });

    it('orders by ID, and rows with the same ID or none as the neume table does', () => {
      const same = buildNotationDoc({
        equivalents: [{ pattern: '*uu', refId: '50' }, { pattern: '*dd', refId: '50' }],
        annotationItems: [item('1', 'r', '*ud'), item('2', 'r', '*du')],
        annotationRegions: [region('r', '45', 1)],
      }, { standard: [{ pattern: '*uu', refId: '' }, { pattern: '*dd', refId: '' }, { pattern: '*', refId: '10' }], order: 'id' });
      // 10 first; the two with ID 50 in the order of the table (*dd is more frequent than *uu); the two without ID last, *ud before *du
      expect(same.rows.map(r => r.pattern)).toEqual(['*', '*dd', '*uu', '*ud', '*du']);
    });

    it('puts the rows in the order of the neume table when asked: shapes by tones and frequency, then the signs', () => {
      const neume = buildNotationDoc(source, { ...setup, order: 'neume' });
      expect(neume.rows.map(r => r.pattern)).toEqual(['*', '*dd', '*ud', '[*du]', '[*dL]']);   // *dd > *ud > *du, as in the editorial order
    });

    it('is empty for a source without annotations, but for the standard set', () => {
      const empty = buildNotationDoc({}, { ...setup, standard: [] });
      expect(empty).toEqual({ rows: [], strips: [], notes: [], withoutId: 0, excluded: 0 });
      expect(buildNotationDoc({}, setup).rows.length).toBe(4);
    });
  });

  describe('flowColumns', () => {
    const h = (n: number, each = 10) => Array(n).fill(each);

    it('fills the columns of the first page top to bottom', () => {
      const flow = flowColumns(h(9), 3, 30, 100);
      expect(flow.map(c => [c.page, c.column, c.indexes.length])).toEqual([[0, 0, 3], [0, 1, 3], [0, 2, 3]]);
    });

    it('goes on on the next page, and spreads the last page evenly over its columns', () => {
      // 3 columns of 30 on page 0 take 9 rows; the 6 left are spread over 3 columns of the next page, not stacked in one
      const flow = flowColumns(h(15), 3, 30, 100);
      expect(flow.filter(c => c.page === 0).length).toBe(3);
      expect(flow.filter(c => c.page === 1).map(c => c.indexes.length)).toEqual([2, 2, 2]);
      expect(flow.flatMap(c => c.indexes)).toEqual(h(15).map((_, i) => i));   // nothing lost, order kept
    });

    it('never splits a row, and a row taller than the column still gets placed', () => {
      const flow = flowColumns([50, 10], 3, 30, 100);
      expect(flow.flatMap(c => c.indexes)).toEqual([0, 1]);
    });

    it('is empty without rows', () => {
      expect(flowColumns([], 3, 30, 100)).toEqual([]);
    });
  });
});
