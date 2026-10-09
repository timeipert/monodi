import { PRINT_PDF_DEFAULTS as D } from './pdf-defaults';
import { sanitizeNotationColor } from './notation-color';
import { sanitizeClefDisplayMode } from './clef-policy';

describe('print-edition defaults', () => {
  it('start the staff where the printed edition does (83.7 pt from the page edge)', () => {
    expect(D.pdfMarginLeft + D.pdfSignaturSpace).toBeCloseTo(83.7, 1);
  });
  it('give a staff line distance of ~3.6 pt (print: 3.65 pt; 10 units per line at the PDF scale)', () => {
    expect(10 * D.pdfScale).toBeGreaterThan(3.5);
    expect(10 * D.pdfScale).toBeLessThan(3.7);
  });
  it('use one embedded serif and valid enumerations', () => {
    expect(D.pdfFontFamily).toBe('CrimsonText');
    expect(sanitizeNotationColor(D.notationColor)).toBe(D.notationColor);
    expect(sanitizeClefDisplayMode(D.clefDisplayMode)).toBe(D.clefDisplayMode);
    expect(['print', 'classic']).toContain(D.pdfPageStyle);
  });
  it('keep body text at 10 pt and the apparatus smaller', () => {
    expect(D.pdfFontSize).toBe(10);
    expect(D.pdfParatextFontSize).toBe(10);
    expect(D.pdfCommentFontSize).toBeLessThan(D.pdfFontSize);
  });
});
