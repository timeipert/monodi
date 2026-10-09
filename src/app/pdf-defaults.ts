/**
 * Defaults that reproduce the look of the printed edition (Corpus Monodicum II/2):
 * one book serif (Crimson Text, Minion-like), 10 pt lyrics and rubrics, 8.5 pt apparatus,
 * staff line distance ~3.6 pt, the staff starting at 83.7 pt, a running head with a rule
 * on every page. Used for fresh settings, as export fallbacks and by the settings preset.
 */
export const PRINT_PDF_DEFAULTS = {
  pdfFontFamily: 'CrimsonText',
  pdfScale: 0.36,
  pdfStaffSpacing: 2,
  pdfSyllableTextOffset: 8,
  pdfSyllableSpacing: 10,
  pdfParatextSpacing: 6.5,
  pdfVerticalSpace: 12,
  pdfTitleFontSize: 12,
  pdfMetadataFontSize: 8.5,
  pdfParatextFontSize: 10,
  pdfFontSize: 10,
  pdfCommentFontSize: 8.5,
  pdfCommentTitleFontSize: 8.5,
  pdfCommentBlockGap: 5,
  pdfHeadlineFontSize: 9,
  pdfPageNumberFontSize: 9,
  pdfMarginLeft: 56.7,
  pdfMarginRight: 56.7,
  pdfMarginTop: 70,
  pdfMarginBottom: 56.7,
  pdfSignaturSpace: 27,
  pdfContinuationIndent: 20,
  pdfPageStyle: 'print' as 'print' | 'classic',
  notationColor: '#333333',
  clefDisplayMode: 'document-start' as const,
};

/** Page size of the printed edition: 21 x 27 cm. */
export const PRINT_PAGE_PT: [number, number] = [595.28, 765.35];

/** Everything "Apply print-edition preset" sets: the defaults plus the page size. */
export const PRINT_PRESET = { ...PRINT_PDF_DEFAULTS, pdfFormat: 'cm', pdfOrientation: 'portrait' };

/** jsPDF `format` for the configured page format ('cm' = the printed edition's 21 x 27 cm). */
export function pdfPageFormat(setting: string | undefined | null): string | [number, number] {
  return setting === 'cm' ? PRINT_PAGE_PT : (setting || 'a4');
}
