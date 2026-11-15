import { FIXTURES } from '../testdata';
import { renderFigurePdf, renderFigureSvg } from './figure';
import * as VM from '../types/model';

/** A built-in font: the unit tests need no font files. */
const SETTINGS = { pdfFontFamily: 'times' };

function jobOf(doc: any) {
  return { document: { id: 'd1', quelle_id: 'S', dokumenten_id: 'S-1', textinitium: 'Test' } as any, cont: doc as VM.RootContainer, source: null, sigle: 'S' };
}

/** The media boxes of a PDF written by jsPDF (page dictionaries are not compressed). */
async function mediaBoxes(blob: Blob): Promise<number[][]> {
  const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
  return [...text.matchAll(/\/MediaBox \[([\d. -]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
}

describe('figure export', () => {
  const real = FIXTURES.filter((f) => f.kind === 'real').slice(0, 2);

  for (const fx of real) {
    it(`${fx.name}: the figure PDF is one page cut to the drawing`, async () => {
      const blob = await renderFigurePdf(jobOf(fx.doc), { settings: SETTINGS });
      const boxes = await mediaBoxes(blob);
      expect(boxes.length).toBe(1);
      const [x0, y0, x1, y1] = boxes[0];
      expect(x0).toBe(0);
      expect(y0).toBe(0);
      // smaller than a printed page in height, and as wide as the drawing needs
      expect(y1).toBeGreaterThan(20);
      expect(y1).toBeLessThan(2000);
      expect(x1).toBeGreaterThan(50);
      expect(x1).toBeLessThanOrEqual(600);
    });

    it(`${fx.name}: the figure PDF has the size of the SVG picture`, async () => {
      const svg = await renderFigureSvg(jobOf(fx.doc), { settings: SETTINGS });
      const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
      const [, , w, h] = (await mediaBoxes(await renderFigurePdf(jobOf(fx.doc), { settings: SETTINGS })))[0];
      expect(Math.abs(w - Number(m[1]))).toBeLessThan(3);
      expect(Math.abs(h - Number(m[2]))).toBeLessThan(3);
    });
  }

  it('an empty document is refused', async () => {
    await expectAsync(renderFigurePdf(jobOf(VM.emptyRootContainer()), { settings: SETTINGS })).toBeRejected();
  });
});
