import { FIXTURES } from './testdata';
import { layoutPdfLine, PdfLayoutItem, PdfLayoutOptions } from './pdf-layout';
import { fromSpaceds, DNote } from './notes/Drawables';
import { CLEF_DISPLAY_MODES, ClefDisplayMode } from './clef-policy';

const SCALE = 0.365;

/** Rough width model of one part, mirroring the editor (svg + text, in pt). */
function toItems(zeile: any): PdfLayoutItem[] {
  const parts: any[] = zeile.children || [];
  return parts.map((p, k) => {
    if (p.kind === 'LineChange' || p.kind === 'FolioChange') return { kind: 'marker', width: p.kind === 'FolioChange' ? 8 + 5 + 4 * (p.text || '').length : 8 } as PdfLayoutItem;
    if (p.kind === 'Syllable') {
      const ds = fromSpaceds([p.notes], []).flat();
      const right = Math.max(0, ...ds.map((d: any) => d.x)) + 20;
      const textW = String(p.text || '').length * 4.6;
      return { kind: 'syllable', width: Math.max(right * SCALE, textW + 10), breakAfterPreferred: parts[k + 1]?.kind === 'LineChange' } as PdfLayoutItem;
    }
    return { kind: 'syllable', width: 35 * SCALE } as PdfLayoutItem;
  });
}

function zeilen(c: any, out: any[] = []): any[] {
  if (c?.kind === 'ZeileContainer') out.push(c);
  (c?.children || []).forEach((k: any) => zeilen(k, out));
  return out;
}

describe('corpus fixtures: layout + drawables', () => {
  it('has fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThan(20);
    expect(FIXTURES.some(f => f.kind === 'real')).toBeTrue();
    expect(FIXTURES.some(f => f.kind === 'extreme')).toBeTrue();
  });

  for (const fx of FIXTURES) {
    it(`${fx.kind}: ${fx.name} lays out validly in every clef mode`, () => {
      for (const z of zeilen(fx.doc)) {
        const items = toItems(z);
        for (const mode of CLEF_DISPLAY_MODES as readonly ClefDisplayMode[]) {
          const o: PdfLayoutOptions = { startX: 100, maxX: 555, continuationIndent: 20, clefWidth: 32 * SCALE, clefMode: mode };
          const r = layoutPdfLine(items, o);
          expect(r.placed.length).toBe(items.length);
          let prevEnd = -Infinity;
          for (const s of r.systems) {
            expect(s.endX).toBeGreaterThanOrEqual(s.startX);
            expect(Number.isFinite(s.endX)).toBeTrue();
          }
          for (const p of r.placed) {
            const sys = r.systems[p.system];
            expect(p.x).toBeGreaterThanOrEqual(sys.startX - 1e-9);
            if (p.index > 0 && r.placed[p.index - 1].system === p.system) {
              expect(p.x).toBeGreaterThanOrEqual(prevEnd - 1e-9);
            }
            prevEnd = p.x + items[p.index].width;
            // no system may start with a marker unless the whole line does
            if (p.index === r.systems[p.system].first && p.system > 0) {
              expect(items[p.index].kind).toBe('syllable');
            }
          }
          if (mode !== 'every-break') expect(r.placed.some(p => p.injectClef)).toBeFalse();
        }
      }
    });

    it(`${fx.kind}: ${fx.name} produces finite drawables`, () => {
      const sylls: any[] = [];
      (function walk(c: any) { if (c?.kind === 'Syllable') sylls.push(c); (c?.children || []).forEach(walk); })(fx.doc);
      for (const s of sylls) {
        for (const d of fromSpaceds([s.notes], []).flat()) {
          expect(Number.isFinite(d.x)).toBeTrue();
          expect(Number.isFinite(d.y)).toBeTrue();
        }
        const notes = fromSpaceds([s.notes], []).flat().filter(d => d instanceof DNote);
        const count = s.notes.spaced.reduce((a: number, n: any) => a + n.nonSpaced.reduce((b: number, g: any) => b + g.grouped.length, 0), 0);
        expect(notes.length).toBe(count);
      }
    });
  }
});
