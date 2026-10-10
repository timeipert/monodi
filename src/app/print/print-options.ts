import { ProjectSettings } from '../api.service';
import { PRINT_PDF_DEFAULTS as D } from '../pdf-defaults';

/** A number from the settings: the default when the value is missing or not a finite number. */
export function num(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export type ContentsApparatus = 'chapters' | 'documents' | 'none';

/**
 * Everything the PDF export reads from the settings, coerced and with its defaults, in one place.
 * Pure: no jsPDF, no Angular. Page style 'print' sets the apparatus as dense as the printed edition
 * (its own size and gap); only the classic style takes them from the older sliders.
 */
export function resolvePrintOptions(s: Partial<ProjectSettings> & { [key: string]: any }) {
  const printLook = s.pdfPageStyle !== 'classic';
  return {
    // page
    pdfMarginLeft: num(s.pdfMarginLeft, D.pdfMarginLeft),
    pdfMarginRight: num(s.pdfMarginRight, D.pdfMarginRight),
    pdfMarginTop: num(s.pdfMarginTop, D.pdfMarginTop),
    pdfMarginBottom: num(s.pdfMarginBottom, D.pdfMarginBottom),
    // edition
    SCALE: num(s.pdfScale, D.pdfScale),
    pdfStaffSpacing: num(s.pdfStaffSpacing, D.pdfStaffSpacing),
    pdfBracketGap: num(s.pdfBracketGap, 5),
    pdfSyllableTextOffset: num(s.pdfSyllableTextOffset, D.pdfSyllableTextOffset),
    extraSyllableSpacing: num(s.pdfSyllableSpacing, D.pdfSyllableSpacing),
    pdfContinuationIndent: num(s.pdfContinuationIndent, D.pdfContinuationIndent),
    pdfFontSize: num(s.pdfFontSize, D.pdfFontSize),
    pdfSignaturSpace: num(s.pdfSignaturSpace, D.pdfSignaturSpace),
    pdfVerticalSpace: num(s.pdfVerticalSpace, D.pdfVerticalSpace),
    widowSlack: Math.max(0, num(s.pdfWidowSlack, D.pdfWidowSlack)),
    hideBareStaff: s.pdfHideStaffWithoutNotes !== false,
    compactTextless: s.pdfCompactTextless !== false,
    // titles, metadata, rubrics
    titleFontSize: num(s.pdfTitleFontSize, D.pdfTitleFontSize),
    pdfTitleVerticalSpace: num(s.pdfTitleVerticalSpace, 20),
    headerSource: (s.pdfHeaderSource as string) || 'textinitium',
    metaFontSize: num(s.pdfMetadataFontSize, D.pdfMetadataFontSize),
    pdfMetadataVerticalSpace: num(s.pdfMetadataVerticalSpace, 15),
    pdfParatextFontSize: num(s.pdfParatextFontSize, D.pdfParatextFontSize),
    pdfParatextSpacing: num(s.pdfParatextSpacing, D.pdfParatextSpacing),
    // apparatus
    printLook,
    pdfCommentStaffScale: printLook ? num(s.pdfApparatusStaffScale, D.pdfApparatusStaffScale) : num(s.pdfCommentStaffScale, D.pdfCommentStaffScale),
    pdfCommentFontSize: num(s.pdfCommentFontSize, D.pdfCommentFontSize),
    pdfCommentBlockGap: printLook ? num(s.pdfApparatusEntryGap, D.pdfApparatusEntryGap) : num(s.pdfCommentBlockGap, D.pdfCommentBlockGap),
    lemmaColumnMax: num(s.pdfLemmaColumnMax, D.pdfLemmaColumnMax),
    // several documents
    chapterHeadings: s.pdfChapterHeadings !== false,
    chapterNewPage: s.pdfChapterNewPage !== false,
    contentsApparatus: (s.pdfContentsApparatus === 'documents' || s.pdfContentsApparatus === 'none' ? s.pdfContentsApparatus : 'chapters') as ContentsApparatus,
    bookmarks: s.pdfBookmarks !== false,
    // running head
    pdfShowPageNumbers: s.pdfShowPageNumbers === true || (s.pdfShowPageNumbers as unknown) === 'true',
    pdfPageNumberFontSize: num(s.pdfPageNumberFontSize, D.pdfPageNumberFontSize),
    pdfHeadlineFontSize: num(s.pdfHeadlineFontSize, D.pdfHeadlineFontSize),
    pdfHeadlineMetadataFields: (s.pdfHeadlineMetadataFields as string[] | undefined) || [],
  };
}

export type PrintOptions = ReturnType<typeof resolvePrintOptions>;
