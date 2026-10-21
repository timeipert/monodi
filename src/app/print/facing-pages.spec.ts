import { jsPDF } from 'jspdf';
import { shiftVersoPages } from './facing-pages';

describe('shiftVersoPages', () => {
  const make = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.text('one', 50, 50);
    doc.addPage(); doc.text('two', 50, 50); doc.link(50, 50, 20, 10, { url: 'https://example.org' });
    doc.addPage(); doc.text('three', 50, 50);
    doc.addPage(); doc.text('four', 50, 50);
    return doc;
  };

  it('moves the even pages and leaves the odd ones, links included', () => {
    const doc = make();
    const internal: any = doc.internal;
    const linkBefore = internal.getPageInfo(2).pageContext.annotations[0].finalBounds;
    const x = parseFloat(linkBefore.x);
    shiftVersoPages(doc, 14.2, 4);
    expect(internal.pages[1].join('\n')).not.toContain(' cm');
    expect(internal.pages[3].join('\n')).not.toContain(' cm');
    for (const n of [2, 4]) {
      expect(internal.pages[n][0]).toBe('q 1 0 0 1 14.200 0 cm');
      expect(internal.pages[n][internal.pages[n].length - 1]).toBe('Q');
    }
    expect(parseFloat(internal.getPageInfo(2).pageContext.annotations[0].finalBounds.x)).toBeCloseTo(x + 14.2, 1);
  });

  it('does nothing for no shift, and keeps the document valid', async () => {
    const doc = make();
    shiftVersoPages(doc, 0, 4);
    expect((doc.internal as any).pages[2][0]).not.toContain(' cm');
    shiftVersoPages(doc, -7, 4);
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(500);
  });
});
