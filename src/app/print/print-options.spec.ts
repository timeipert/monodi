import { num, resolvePrintOptions } from './print-options';
import { PRINT_PDF_DEFAULTS as D } from '../pdf-defaults';

describe('print options', () => {
  it('num: a valid number passes, anything else gives the default', () => {
    expect(num(3.5, 1)).toBe(3.5);
    expect(num('4', 1)).toBe(4);
    expect(num(0, 1)).toBe(0);
    for (const bad of [undefined, null, '', 'abc', NaN, Infinity]) expect(num(bad, 7)).toBe(7);
  });

  it('empty settings give the print defaults', () => {
    const o = resolvePrintOptions({});
    expect(o.SCALE).toBe(D.pdfScale);
    expect(o.pdfMarginLeft).toBe(D.pdfMarginLeft);
    expect(o.pdfCommentStaffScale).toBe(D.pdfApparatusStaffScale);
    expect(o.pdfCommentBlockGap).toBe(D.pdfApparatusEntryGap);
    expect(o.widowSlack).toBe(D.pdfWidowSlack);
    expect(o.contentsApparatus).toBe('chapters');
    expect(o.chapterHeadings && o.chapterNewPage && o.bookmarks && o.hideBareStaff && o.compactTextless).toBeTrue();
  });

  it('never yields NaN for broken numbers', () => {
    const o = resolvePrintOptions({ pdfScale: 'x' as any, pdfMarginTop: NaN as any, pdfWidowSlack: -5 });
    expect(o.SCALE).toBe(D.pdfScale);
    expect(o.pdfMarginTop).toBe(D.pdfMarginTop);
    expect(o.widowSlack).toBe(0);
  });

  it('the print style uses the apparatus options, the classic style the older sliders', () => {
    const s = { pdfApparatusStaffScale: 0.3, pdfApparatusEntryGap: 6, pdfCommentStaffScale: 0.5, pdfCommentBlockGap: 20 };
    const p = resolvePrintOptions({ ...s, pdfPageStyle: 'print' });
    expect([p.pdfCommentStaffScale, p.pdfCommentBlockGap]).toEqual([0.3, 6]);
    const c = resolvePrintOptions({ ...s, pdfPageStyle: 'classic' });
    expect([c.pdfCommentStaffScale, c.pdfCommentBlockGap]).toEqual([0.5, 20]);
  });

  it('switches default to on, and only an explicit false turns them off', () => {
    const o = resolvePrintOptions({ pdfChapterNewPage: false, pdfBookmarks: false, pdfHideStaffWithoutNotes: false });
    expect([o.chapterNewPage, o.bookmarks, o.hideBareStaff, o.chapterHeadings]).toEqual([false, false, false, true]);
  });

  it('the contents mode falls back to the manuscripts for unknown values', () => {
    expect(resolvePrintOptions({ pdfContentsApparatus: 'documents' }).contentsApparatus).toBe('documents');
    expect(resolvePrintOptions({ pdfContentsApparatus: 'none' }).contentsApparatus).toBe('none');
    expect(resolvePrintOptions({ pdfContentsApparatus: 'weird' as any }).contentsApparatus).toBe('chapters');
  });
});
