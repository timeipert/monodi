import { Injectable, NgZone } from '@angular/core';
import { jsPDF } from 'jspdf';
import * as VM from './types/model';
import { Document, ProjectSettings, Source } from './api.service';
import { embeddedFamily, registerEmbeddedFont } from './pdf-font';
import { PRINT_PDF_DEFAULTS, pdfPageFormat } from './pdf-defaults';
import { layoutPdfLine } from './pdf-layout';
import { sanitizeNotationColor } from './notation-color';
import { ClefDisplayMode, sanitizeClefDisplayMode, shouldShowClef } from './clef-policy';
import { commentSignature, commentLemma, commentStartIndex, commentType, printableComments, treeRepeatsLemma, treeStartsWithBracket, treeStartsWithTextedNotes } from './comment-lemma';
import { resolvePrintOptions } from './print/print-options';
import { layoutSignature } from './print/signature';
import { LeadItem, PageBox, atPageTop, needsBreak, systemsToKeep } from './print/keep';
import { arrangeChapter } from './print/arrange';
import { chapterize } from './print/chapters';
import { formatFolioLabel, sanitizeFolioPrefixMode, usesFolioPrefix } from './folio-label';
import { genreOf, headlineText as buildHeadline, inlineMetadataItems, metadataFieldValue } from './document-metadata';
import { getCategoryDetails } from './comment/comment-categories';
import { documentBlocks, printedParts } from './print/document-blocks';
import { HeadingPart, headingParts } from './print/doc-heading';
import { CapsMode, TextStyle, capsModeFor, smallCapsRuns, styledLyric } from './print/text-style';
import { SyllableGeometry, isEmptySyllable, syllableGeometry } from './print/notation-geometry';
import { drawGClef, drawStaff, drawSyllableNotation, RGB } from './print/notation-draw';
import { Box, TreeKit, layoutCommentTree } from './print/comment-tree-layout';
import { FontStyle, TextKit, breakLines, drawLines, linesWidth } from './print/rich-text';
import { MdBlock, MdInline, parseMarkdown, safeHref } from './print/markdown';
import { MdLine, layoutInlines, lineWidth } from './print/markdown-layout';
import { LoadedImage, loadImage } from './print/image-loader';
import { sourceDescription } from './source-description';
import { buildNotationDoc, NotationDoc, notationNotes } from './notation-doc';
import { readSetup } from './notation-set';
import { drawEquivalents, drawNeumeTree, drawNotes, drawStrips, drawSubheading, NOTATION_TEXT, NotationHost } from './print/notation-doc-draw';
import { loadStripPictures } from './print/notation-doc-images';
import { loadStripImages } from './notation-strip-images';
import { TitleTemplate } from './print/title-page';
import { drawCover } from './print/cover-draw';
import { FieldJob, makeLookup } from './print/fields';

/** Internal-unit width of an injected clef (same as NotesComponent.CLEF_WIDTH). */
/** Grey level of the brackets in the apparatus. */
const PDF_APPARATUS_BRACKET = 50;
/** A signature set before the staff keeps at least this far from the page edge (pt). */
const PDF_SIGNATURE_PAGE_EDGE = 28;
const PDF_CLEF_WIDTH = 32;
/** Distance between the two strokes of a folio-change marker (pt). */
const PDF_MARKER_TICK_GAP = 2;
/** Gap below the last paratext baseline before the system starts (descender room). */
const PDF_PARATEXT_BELOW = 5;
/** Minimum room above the top staff line inside a system (raw SVG units). */
const PDF_MIN_HEADROOM_UNITS = 10;
/** Small-capital size relative to the text size. */
const SMALL_CAPS = 0.8;
/** Comment corner marks: grey, thin, small. */
const PDF_CORNER_GREY = 140;
/** Light grey of keys / labels in front matter and tables. */
const PDF_KEY_GREY = 150;
/** Title page: size of the title. */
const PDF_TITLE_PAGE_SIZE = 22;
const PDF_CORNER_WIDTH = 0.5;
const PDF_CORNER_LEG = 3;
const PDF_CORNER_FOOT = 3;
/** Text edge relative to the staff start (print edition: 89.1 - 83.7 pt). */
const PDF_TEXT_INSET = 5.4;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface PdfMeasuredPart {
  /** The model part this entry prints. */
  lp: VM.LinePart;
  /** Notation of a syllable (null for markers). */
  geom: SyllableGeometry | null;
  /** Raw height of one voice's staff block (further voices are stacked). */
  voiceStep: number;
  isMarker: boolean;
  txt: string;
  secHeight: number;
  /** Height without the lyric zone under the staff (systems that carry no text). */
  secHeightBare?: number;
  finalSecWidth: number;
  width: number;
  hasClef: boolean;
  /** Folio change only: its label and the label's width in pt (not part of `width`). */
  folioLabel?: string;
  labelWidth?: number;
  /** Extra space (pt) the syllable text must move down to clear ledger lines below the staff. */
  belowExtra?: number;
  /** SVG width in pt (the lyric width may widen the part beyond it). */
  svgWidth: number;
  /** Raw SVG units of the 30 above the top staff line that this part does not need. */
  trimUnits?: number;
  /** Raw SVG y that sits at the top edge of the SVG (20 - top padding; 10 in the standard layout). */
  rawTop?: number;
  /** Left edge of the lyric relative to the part (pt): it starts at the first note head, not at the staff start / clef. */
  lyricShift: number;
  /** Width of the lyric in pt (0 without lyric). */
  lyricWidth: number;
  /** Lyric set in small capitals (all-caps syllables as in the printed edition, or by the status style). */
  smallCaps?: CapsMode;
}

/** One document to print: its metadata, transcription and (for the running head) its source. */
export interface PdfDocJob {
  document: Document;
  cont: VM.RootContainer;
  source: Source | null;
  sigle: string;
}

/** Framed number before each document of a multi-document print: the running number within
 *  its manuscript (chapter), or nothing. */
export type PdfBoxLabel = 'number' | 'none';

export interface PdfExportOptions {
  settings: ProjectSettings | null;
  /** A title page (always present for several documents). */
  titlePage: boolean;
  /** Metadata: a table on the title page (one document) / a line under each document's title. */
  includeMetadata: boolean;
  /** The collected critical apparatus. */
  apparatus: boolean;
  /** The sources' Markdown descriptions, appended after the editions and the apparatus. */
  sourceDescriptions?: boolean;
  /** The notation documentation of each manuscript (neume table with its signs, strips of the lines they stand in), after the source descriptions. */
  notationDocumentation?: boolean;
  /** The neume tree of each manuscript in the notation documentation (needs `notationDocumentation`). */
  neumeTree?: boolean;
  /** Several documents: the contents table on the title page (needs a title page). Default: yes. */
  contents?: boolean;
  /** Several documents: every document starts on a new page. Default: no — they run on in one flow. */
  newPagePerDocument?: boolean;
  /** The framed running number in the left margin (default: shown). */
  boxLabel?: PdfBoxLabel;
  /** Documents that belong together stand together: a unit as one block, a related document (the primary chant of a trope) behind its trope, numbered 1P. Default: yes. */
  arrangeRelated?: boolean;
  /** Override of the configured page format ('a4', 'cm' = 21 x 27 cm, ...). */
  pageFormat?: string;
  /** Title of a multi-document print (title page). */
  title?: string;
  /** A cover before everything else, set from a template with placeholders. `group`: what the volume is called when a print is split. */
  cover?: { template: TitleTemplate; group?: string; groupField?: string; groupParts?: string[] };
  /** The cover and the title page / contents count as pages: the edition begins at page 3, as in a printed volume. Default: the edition is numbered from 1. */
  countFrontPages?: boolean;
  /** 'save' (default) starts the download; 'blob' hands the PDF back in the stats (volumes that are zipped, the cover preview). */
  output?: 'save' | 'blob';
  fileName?: string;
  onProgress?: (message: string, done: number, total: number) => void;
}

export interface PdfExportStats {
  clefs: number;
  systems: number;
  pages: number;
  /** Documents in print order with the page (edition numbering) they start on. */
  documents: { id: string; page: number }[];
  /** Page of the critical apparatus, 0 if there is none. */
  apparatusPage: number;
  /** Page of the source descriptions, 0 if there are none. */
  descriptionPage: number;
  /** Page of the notation documentation, 0 if there is none. */
  notationPage?: number;
  /** What could not be shown in it (strips without an image, …). */
  notationProblems?: string[];
  /** Lines of the contents table: "ID | incipit | genre", page. */
  outline: { label: string; page: number; depth: number }[];
  /** Pages in front of the edition: the cover and the title page / contents (the contents may take several). */
  frontPages?: number;
  /** The PDF itself when `output` was 'blob'. */
  blob?: Blob;
  /** Where the time went (ms): render, measure, svg (drawing the notes), apparatus, save, total. */
  timings: { [phase: string]: number };
  /** Where things landed (physical page numbers) — the tests check the page-break rules with it. */
  placement: {
    /** Per document: page of its first heading item and page of its first system. */
    documents: { job: number; head: number; firstSystem: number }[];
    /** Per line of notes (Zeile): the page of each of its systems. */
    lines: { job: number; pages: number[]; /** page of the rubrics/headings queued in front of it (0 if none) */ leadPage: number }[];
    /** Per document in the apparatus: page of its heading items and of its first entry. */
    apparatus: { job: number; head: number; entry: number }[];
  };
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  lastStats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, descriptionPage: 0, outline: [], timings: {}, placement: { documents: [], lines: [], apparatus: [] } };

  constructor(private zone: NgZone) {}


  /**
   * Measures the printed parts of a line straight from the model (no DOM): syllable geometry
   * from the drawables, lyric widths in the PDF font, marker widths. The vertical numbers keep
   * the conventions of the edition view (raw top 10, 65 + 10 + bottom padding per voice).
   */
  private measureLineParts(zeile: VM.ZeileContainer, c: {
    doc: jsPDF; fontFamily: string; pdfFontSize: number; SCALE: number; extraSyllableSpacing: number;
    textOffset: number; clefMode: ClefDisplayMode; firstSyllableUuid: string | null;
    /** Case style of the section's status (upper/lower case are applied here; small capitals in the layout loop). */
    textStyle?: TextStyle;
    /** Leave out syllables with neither text nor notes (they would only leave gaps). */
    skipEmpty?: boolean;
    /** Syllables a comment starts or ends on: never left out, even when empty (the comment would lose its bracket). */
    keepUuids?: Set<string>;
    /** Turns the typed folio label into the printed one. */
    formatFolio: (label: string) => string;
  }): PdfMeasuredPart[] {
    const { doc, fontFamily, pdfFontSize, SCALE } = c;
    const adiastematic = zeile.notation === 'adiastematic';
    const children = zeile.children || [];
    const out: PdfMeasuredPart[] = [];
    // a line made only of empty syllables keeps them (nothing else would be left to draw)
    const skipEmpty = !!c.skipEmpty && children.some((p) => p.kind === 'Syllable' && !isEmptySyllable(p));
    children.forEach((lp, idx) => {
      if (lp.kind === 'LineChange' || lp.kind === 'FolioChange') {
        // gap, [second tick], gap + 2 — the folio label is placed by the layout loop
        let width = 3 + 3 + 2;
        let folioLabel: string | undefined;
        let labelWidth = 0;
        if (lp.kind === 'FolioChange') {
          width += PDF_MARKER_TICK_GAP;
          folioLabel = c.formatFolio((lp.text || '').trim()) || undefined;
          if (folioLabel) {
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(pdfFontSize * 0.85);
            labelWidth = doc.getTextWidth(folioLabel);
            doc.setFontSize(pdfFontSize);
          }
        }
        out.push({ lp, geom: null, voiceStep: 0, isMarker: true, txt: '', secHeight: 0, finalSecWidth: width, width, svgWidth: 0, hasClef: false, folioLabel, labelWidth, lyricShift: 0, lyricWidth: 0 });
        return;
      }
      if (lp.kind !== 'Syllable') return;
      if (skipEmpty && isEmptySyllable(lp) && lp.uuid !== c.firstSyllableUuid && !c.keepUuids?.has(lp.uuid)) return;
      const showClef = !adiastematic && (lp.uuid === c.firstSyllableUuid || shouldShowClef(c.clefMode, {
        firstInDocument: false, firstInZeile: idx === 0, afterLineChange: idx > 0 && children[idx - 1].kind === 'LineChange', wrapStart: false,
      }));
      const geom = syllableGeometry(lp, { showClef, adiastematic });
      const voiceHeights = geom.voices.map((_, v) => 65 + 10 + Math.max(16, Math.ceil((geom.lowest[v] || 0) + 2 - 85)));
      const secHeight = voiceHeights.reduce((a, b) => a + b, 0) * SCALE;
      // the same without the lyric zone under the staff: for systems that carry no text at all
      const secHeightBare = geom.voices.reduce((acc, _, v) => acc + 65 + 10 + Math.max(4, Math.ceil((geom.lowest[v] || 0) + 2 - 85)), 0) * SCALE;
      const svgWidth = geom.widthUnits * SCALE;

      let txt = (lp.text || '').trim();
      let textWidth = 0;
      if (txt && txt !== 'X' && txt !== '...' && txt !== '<...>') {
        txt = styledLyric(txt.replace(/-$/, '\u2013'), c.textStyle);   // the printed edition marks a syllable break with an en dash
        doc.setFontSize(pdfFontSize);
        doc.setFont(fontFamily, 'normal');
        textWidth = doc.getTextWidth(txt);
      } else {
        txt = '';
      }
      // the lyric starts at the first note head (right of the clef)
      const lyricShift = geom.shiftUnits >= 0 ? Math.max(0, geom.shiftUnits - 0.5) * SCALE : 0;
      // a syllable without text keeps the gap a lyric would give it, so that text-less chants set like texted ones
      const finalSecWidth = Math.max(svgWidth + (skipEmpty && !txt ? c.extraSyllableSpacing : 0), lyricShift + textWidth + c.extraSyllableSpacing - 12 * SCALE);

      // room above the top staff line that is actually needed (negative trim = very high notes)
      let trimUnits = 0;
      if (geom.voices.length === 1) {
        const headroom = Math.max(PDF_MIN_HEADROOM_UNITS, 40 - geom.minTop + 3);
        trimUnits = 30 - headroom;
      }
      // ledger lines below the staff must not run into the lyric
      let belowExtra = 0;
      if (geom.lowestLedger > 80) {
        const clearTop = SCALE * (geom.lowestLedger - 10 + 5);
        const textTop = secHeight + c.textOffset - pdfFontSize * 0.7;
        belowExtra = Math.max(0, clearTop - textTop);
      }
      out.push({
        lp, geom, voiceStep: voiceHeights[0] || 91, isMarker: false, txt, secHeight, secHeightBare, finalSecWidth, width: finalSecWidth, svgWidth,
        hasClef: geom.showClef, belowExtra, trimUnits, rawTop: 10, lyricShift, lyricWidth: textWidth,
      });
    });
    return out;
  }

  /** Width of a lyric in pt; all-caps syllables are measured as small capitals. */
  private lyricWidth(doc: jsPDF, fontFamily: string, txt: string, fs: number, caps?: CapsMode): number {
    doc.setFont(fontFamily, 'normal');
    if (!caps) { doc.setFontSize(fs); return doc.getTextWidth(txt); }
    let w = 0;
    for (const r of smallCapsRuns(txt, caps)) { doc.setFontSize(r.big ? fs : fs * SMALL_CAPS); w += doc.getTextWidth(r.text); }
    doc.setFontSize(fs);
    return w;
  }

  private drawLyric(doc: jsPDF, fontFamily: string, txt: string, x: number, y: number, fs: number, caps?: CapsMode): void {
    doc.setFont(fontFamily, 'normal');
    if (!caps) { doc.setFontSize(fs); doc.text(txt, x, y); return; }
    let cx = x;
    for (const r of smallCapsRuns(txt, caps)) {
      doc.setFontSize(r.big ? fs : fs * SMALL_CAPS);
      doc.text(r.text, cx, y);
      cx += doc.getTextWidth(r.text);
    }
    doc.setFontSize(fs);
  }

  /**
   * Typesets one or several documents into one PDF like the printed edition. One document:
   * optional title page with metadata, then the edition and its apparatus. Several documents:
   * title page with a contents table (ID, incipit, genre), each document starting on a new
   * page, and one collected apparatus that is divided by document.
   */
  async exportDocuments(jobs: PdfDocJob[], opts: PdfExportOptions): Promise<PdfExportStats> {
    // Outside Angular's zone: every promise and timer that finishes inside it would trigger a
    // change detection of the whole page behind the dialog — thousands of them while drawing.
    // Progress is reported back into the zone so the dialog still updates.
    const inZoneOpts: PdfExportOptions = { ...opts, onProgress: opts.onProgress ? (m, d, t) => this.zone.run(() => opts.onProgress!(m, d, t)) : undefined };
    return this.zone.runOutsideAngular(() => this.exportInner(jobs, inZoneOpts));
  }

  /** The jsPDF document in the page format and font of the settings. */
  private async newDocument(opts: Pick<PdfExportOptions, 'settings' | 'pageFormat'>): Promise<{ doc: jsPDF; s: any; fontFamily: string }> {
    const s: any = { ...(opts.settings || {}), ...(opts.pageFormat ? { pdfFormat: opts.pageFormat, pdfOrientation: 'portrait' } : {}) };
    const doc = new jsPDF({ unit: 'pt', format: pdfPageFormat(s.pdfFormat), orientation: (s.pdfOrientation || 'portrait'), compress: true });
    const fontSetting: string = s.pdfFontFamily || PRINT_PDF_DEFAULTS.pdfFontFamily;
    const fontFamily = embeddedFamily(fontSetting) || fontSetting;
    if (embeddedFamily(fontFamily)) await registerEmbeddedFont(doc, fontFamily);
    return { doc, s, fontFamily };
  }

  /** The cover alone as a one-page PDF: what the cover editor shows. Reports what does not fit and which placeholders are unknown. */
  async renderCover(jobs: FieldJob[], opts: Pick<PdfExportOptions, 'settings' | 'pageFormat' | 'title' | 'cover'>): Promise<{ blob: Blob; overflow: boolean; unknown: string[] }> {
    if (!opts.cover) throw new Error('No cover');
    return this.zone.runOutsideAngular(async () => {
      const { doc, fontFamily } = await this.newDocument(opts);
      const lookup = makeLookup(jobs, opts.settings, opts.cover!.template.variables, { titel: opts.title, gruppe: opts.cover!.group, gruppenfeld: opts.cover!.groupField, gruppenteile: opts.cover!.groupParts });
      const layout = drawCover(doc, opts.cover!.template, lookup, fontFamily);
      return { blob: doc.output('blob'), overflow: layout.overflow, unknown: layout.unknown };
    });
  }

  private async exportInner(jobsIn: PdfDocJob[], opts: PdfExportOptions): Promise<PdfExportStats> {
    if (!jobsIn.length) throw new Error('Nothing to print');
    // Documents of one manuscript belong together: each manuscript is a chapter (stable by first appearance).
    const chapterKeyOf = (j: PdfDocJob) => (j.source as any)?.id ?? (j.sigle || (j.source as any)?.quellensigle || '');
    const { items: jobs, chapterNo, chapterFirst, labels, count: chapterCount } = chapterize(
      jobsIn, chapterKeyOf,
      opts.arrangeRelated === false ? undefined : (items) => arrangeChapter(items, (j) => j.document, opts.settings),
    );
    const stats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, descriptionPage: 0, outline: [], timings: {}, placement: { documents: [], lines: [], apparatus: [] } };
    const t0 = performance.now();
    /** Adds the time `fn` takes to the phase `name`. */
    const timedSync = <T>(name: string, fn: () => T): T => {
      const a = performance.now();
      try { return fn(); } finally { stats.timings[name] = (stats.timings[name] || 0) + (performance.now() - a); }
    };
    this.lastStats = stats;
    const multi = jobs.length > 1;

    try {
        const { doc, s, fontFamily } = await this.newDocument(opts);
        const {
          pdfMarginLeft, pdfMarginRight, pdfMarginTop, pdfMarginBottom, SCALE, pdfStaffSpacing, pdfBracketGap, pdfSyllableTextOffset,
          extraSyllableSpacing, pdfContinuationIndent, pdfFontSize, pdfSignaturSpace, pdfVerticalSpace, widowSlack, hideBareStaff,
          compactTextless, skipEmptySyllables, statusTextStyles, titleFontSize, pdfTitleVerticalSpace, headerSource, metaFontSize, pdfMetadataVerticalSpace,
          pdfParatextFontSize, pdfParatextSpacing, pdfCommentStaffScale, pdfCommentFontSize, pdfCommentBlockGap, lemmaColumnMax,
          chapterHeadings, chapterNewPage, partStyle, contentsEdition, contentsApparatus, pdfShowPageNumbers, pdfPageNumberFontSize, pdfHeadlineFontSize,
          pdfHeadlineMetadataFields, bookmarks, docHeadingFields, docHeadingSeparator,
        } = resolvePrintOptions(s);
        // Titles, metadata and paratexts share one left edge, set just inside the staff
        // start (print edition: staff at 83.7 pt, text at 89.1 pt).
        const textX = pdfMarginLeft + pdfSignaturSpace + PDF_TEXT_INSET;
        const notationColor = hexToRgb(sanitizeNotationColor(s.notationColor));

        let cursorY = pdfMarginTop;
        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        const printWidth = pageWidth - pdfMarginLeft - pdfMarginRight;
        const maxContentY = pageHeight - pdfMarginBottom;

        const checkPageOverflow = (neededHeight: number) => {
          if (cursorY + neededHeight > maxContentY) {
            doc.addPage();
            cursorY = pdfMarginTop;
          }
        };


        const clefMode: ClefDisplayMode = sanitizeClefDisplayMode(s.clefDisplayMode);
        const useTitlePage = opts.titlePage;
        // The cover (if any) is page 1, the title page / contents follow it; the edition starts behind them.
        const coverPages = opts.cover ? 1 : 0;
        let titlePageCount = coverPages + (useTitlePage ? 1 : 0);
        for (let i = 0; i < titlePageCount; i++) doc.addPage();
        cursorY = pdfMarginTop;
        // Page numbers shown: the edition from 1, or — counting the front pages — behind them (fixed from the start; a
        // contents table that grows into further pages cannot move what is already recorded).
        const numberOffset = opts.countFrontPages ? titlePageCount : 0;
        const editionPage = () => doc.getNumberOfPages() - titlePageCount + numberOffset;
        // The contents table may grow into further title pages at the end; they push every recorded page number on.
        const initialTitlePages = titlePageCount;
        const pageShift = () => titlePageCount - initialTitlePages;
        const docEntries: { job: number; page: number }[] = [];
        const docStart: number[] = [];   // physical page on which each document starts
        const apparatusSpans: { job: number; from: number }[] = [];
        const apparatusOutline: { label: string; depth: number; job: number; page: number }[] = [];
        let apparatusStarted = false;
        let apparatusPage = 0;
        const titleOf = (j: PdfDocJob) => metadataFieldValue(j.document, headerSource) || j.document.textinitium || 'New Document';
        const sourceLineOf = (j: PdfDocJob): string => {
          const src: any = j.source || {};
          return [src.bibliotheksort || src.herkunftsort, src.bibliothek, src.bibliothekssignatur]
            .map((v: any) => (v || '').toString().trim()).filter(Boolean).join(', ');
        };
        // Chapters: every manuscript has its own chapter (heading, running head, contents entry);
        // inside it the documents are numbered 1, 2, 3 … in the frame before each document.
        const boxTexts = labels;
        // Folio labels: a manuscript whose labels say "f." somewhere is foliated — all of its labels get it
        const folioMode = sanitizeFolioPrefixMode(s.pdfFolioPrefix);
        const foliated = new Map<string, boolean>();
        for (const j of jobs) {
          const labels = VM.getAllLineParts(j.cont).filter((p) => p.kind === 'FolioChange').map((p) => String((p as any).text || ''));
          const key = chapterKeyOf(j);
          foliated.set(key, (foliated.get(key) ?? false) || usesFolioPrefix(labels));
        }
        // a single document has no running number; the frame is for printed series only
        const showBox = jobs.length > 1 && s.pdfShowEditionBox !== false && (opts.boxLabel || 'number') !== 'none';
        const boxTextOf = (ji: number) => (showBox ? boxTexts[ji] : '');
        /** Draws the frame and its text inside the left margin: the text shrinks, then is cut off,
         *  before it could reach the heading. */
        const drawBox = (label: string, baseline: number, fs: number) => {
          if (!label) return;
          const maxW = textX - pdfMarginLeft - 5;
          let size = fs;
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(size);
          while (doc.getTextWidth(label) + 7 > maxW && size > 5.5) { size -= 0.5; doc.setFontSize(size); }
          let text = label;
          while (text.length > 1 && doc.getTextWidth(text) + 7 > maxW) text = text.slice(0, -1);
          if (text !== label) text = text.slice(0, -1) + '\u2026';
          const w = doc.getTextWidth(text) + 7;
          doc.setLineWidth(0.5);
          doc.setDrawColor(0, 0, 0);
          doc.setTextColor(0, 0, 0);
          doc.rect(pdfMarginLeft, baseline - fs * 0.82 - 2, w, fs + 4);
          doc.text(text, pdfMarginLeft + 3.5, baseline);
        };
        const headOf = (ji: number): string => {
          const j = jobs[ji];
          const src: any = j.source || {};
          const siglum = (j.sigle || src.quellensigle || '').toString().trim();
          return [sourceLineOf(j), siglum].filter(Boolean).join(' | ')
            || buildHeadline(j.document, pdfHeadlineMetadataFields, opts.settings) || (j.document.dokumenten_id || '');
        };
        const placeOf = (ji: number): string => {
          const src: any = jobs[ji].source || {};
          return (src.bibliotheksort || src.herkunftsort || '').toString().trim();
        };
        const siglumOf = (ji: number): string => ((jobs[ji].sigle || (jobs[ji].source as any)?.quellensigle || '') as string).toString().trim();
        /** "1. Utrecht": the manuscript's number and place (the library's town). */
        /** Manuscripts get their own rows (contents, bookmarks): with several manuscripts, or — when the contents list only manuscripts — also with one. */
        const chapterRows = chapterCount > 1 || contentsEdition !== 'documents';
        const chapterTitleOf = (ji: number): string => (chapterCount > 1 ? chapterNo[ji] + '. ' : '') + (placeOf(ji) || siglumOf(ji) || headOf(ji));
        /** Contents / bookmark entry of a manuscript: "1. Utrecht | Ut 417". */
        const chapterLabelOf = (ji: number): string => (chapterCount > 1 ? chapterNo[ji] + '. ' : '') + ([placeOf(ji), siglumOf(ji)].filter(Boolean).join(' | ') || headOf(ji));
        // Cross references ("Edition: p. 15 | …") are written at the end, when the pages are known.
        const crossRefs: { page: number; y: number; ji: number }[] = [];
        let multiPart = false;
        let suppressDocRule = false;
        /** True while `dryRun` measures: code with side effects beyond drawing (cross references, outline entries) skips them. */
        let dry = false;
        const drawBoldLines = (text: string, x: number, size: number, width: number, color = 0): void => {
          doc.setFont(fontFamily, 'bold');
          doc.setFontSize(size);
          doc.setTextColor(color, color, color);
          const lines: string[] = doc.splitTextToSize(text, width);
          lines.forEach((l, li) => doc.text(l, x, cursorY + size + li * size * 1.2));
          cursorY += size + (lines.length - 1) * size * 1.2;
        };
        /**
         * Start of a manuscript as in the printed volume — no rules: the number and place in large
         * bold, the shelfmark and sigle in bold below; the edition adds the type, the origin and
         * the references to the other parts in small type. The apparatus and the descriptions
         * (`full` = false) take the first two lines.
         */
        const drawChapterBlock = (ji: number, x: number, width: number, full: boolean): void => {
          const src: any = jobs[ji].source || {};
          drawBoldLines(chapterTitleOf(ji), x, full ? 14 : 11.5, width);
          cursorY += 9;
          drawBoldLines(headOf(ji), x, full ? 10.5 : 8.5, width);
          cursorY += full ? 14 : 10;
          if (full) {
            const origin = [[src.herkunftsort, src.herkunftsinstitution].filter(Boolean).join(', '), src.datierung].filter(Boolean).join(' | ');
            for (const line of [(src.quellentyp || '').toString().trim(), origin]) {
              if (!line) continue;
              drawBoldLines(line, x, 8.5, width);
              cursorY += 4;
            }
            if (multiPart) {
              cursorY += 4;
              if (!dry) crossRefs.push({ page: doc.getNumberOfPages(), y: cursorY + 7.5, ji });
              cursorY += 7.5 + 36;
            } else cursorY += 18;
            suppressDocRule = true;
          } else cursorY += 4;
          doc.setTextColor(0, 0, 0);
        };
        // Part pages (print volume): a page with the part's name in grey and a hairline rule running
        // off the right edge — no running head, no page number (the page still counts).
        const partPages = new Set<number>();
        let volumeParts = false;
        const drawPartPage = (title: string): void => {
          partPages.add(doc.getNumberOfPages());
          const x = pageWidth * 0.4;
          const y = pageHeight * 0.288;
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(24);
          doc.setTextColor(120, 120, 120);
          doc.text(title, x, y);
          doc.setDrawColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
          doc.setLineWidth(0.5);
          doc.line(x, y + 10, pageWidth, y + 10);
          doc.setTextColor(0, 0, 0);
          doc.addPage();
          cursorY = pdfMarginTop;
        };
        const ownerOf = (finalPage: number): number => {
          const page = finalPage - pageShift();
          if (apparatusSpans.length && page >= apparatusSpans[0].from) {
            let owner = apparatusSpans[0].job;
            for (const sp of apparatusSpans) if (sp.from <= page) owner = sp.job;
            return owner;
          }
          let owner = 0;
          docStart.forEach((p, i) => { if (p <= page) owner = i; });
          return owner;
        };

        // Headings share one style: small uppercase, letter-spaced, with a hairline rule.
        /** Section heading: letter-spaced capitals over a fine grey rule, then a clear gap. */
        const drawHeading = (text: string, x: number, y: number, width: number, size = 9.5): number => {
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(size);
          doc.setTextColor(30, 30, 30);
          doc.text(text.toUpperCase(), x, y, { charSpace: 1.3 });
          doc.setDrawColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
          doc.setLineWidth(0.35);
          doc.line(x, y + 5.5, x + width, y + 5.5);
          doc.setTextColor(0, 0, 0);
          return y + 5.5 + size * 1.25;
        };
        const textColumnW = pageWidth - pdfMarginRight - textX;


        /** Draws heading parts from `textX` on, word-wrapped; leaves cursorY on the last line's baseline. */
        const flowHeading = (parts: HeadingPart[], fs: number): void => {
          const rightEdge = pageWidth - pdfMarginRight;
          const lineH = fs * 1.25;
          let curX = textX;
          const word = (w: string, style: 'bold' | 'normal' | 'grey', isSpace: boolean) => {
            doc.setFont(fontFamily, style === 'bold' ? 'bold' : 'normal');
            doc.setFontSize(fs);
            const ww = doc.getTextWidth(w);
            if (!isSpace && curX + ww > rightEdge && curX > textX) {
              curX = textX;
              cursorY += lineH;
              if (cursorY > maxContentY) { doc.addPage(); cursorY = pdfMarginTop; }
            }
            if (isSpace && curX === textX) return;
            if (style === 'grey') doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY); else doc.setTextColor(0, 0, 0);
            doc.text(w, curX, cursorY);
            curX += ww;
          };
          const run = (text: string, style: 'bold' | 'normal' | 'grey') => {
            for (const w of text.match(/\s+|\S+/g) || []) word(w, style, /^\s+$/.test(w));
          };
          parts.forEach((p, i) => {
            if (i > 0) run(docHeadingSeparator, 'normal');
            if (p.label) run(p.label + ': ', 'grey');
            run(p.text, p.style);
          });
          doc.setTextColor(0, 0, 0);
        };

        // ── Keeping things together on a page ─────────────────────────────────────────────────
        // Whatever stands in front of a system (gap, manuscript and document headings, metadata, rubrics)
        // is not drawn at once but queued: only when the system that follows is known can it be decided
        // whether everything fits on the page together — otherwise the page breaks before the heading,
        // and a heading is never left alone at the bottom of a page.
        const pageBox: PageBox = { top: pdfMarginTop, bottom: maxContentY };
        const DRY_NOOPS = ['text', 'line', 'rect', 'roundedRect', 'lines', 'path', 'circle', 'ellipse', 'triangle', 'fill', 'stroke', 'fillEvenOdd', 'addImage', 'link', 'textWithLink'];
        /** The height `draw` takes, measured by running it with the drawing calls switched off: nothing is drawn and the cursor stays. */
        const dryRun = (draw: () => void): number => {
          const d = doc as any;
          const saved: Record<string, any> = {};
          for (const m of [...DRY_NOOPS, 'addPage']) saved[m] = d[m];
          const y0 = cursorY, rule0 = suppressDocRule;
          let overflowed = false;
          dry = true;
          for (const m of DRY_NOOPS) d[m] = () => doc;
          d.addPage = () => { overflowed = true; return doc; };
          try {
            draw();
            return overflowed ? pageBox.bottom - pageBox.top : cursorY - y0;
          } finally {
            for (const m of Object.keys(saved)) { if (saved[m] === undefined) delete d[m]; else d[m] = saved[m]; }
            dry = false; cursorY = y0; suppressDocRule = rule0;
          }
        };
        const lead: LeadItem[] = [];
        const defer = (h: number, draw: () => void, dropAtTop = false): void => { lead.push({ h, draw, dropAtTop }); };
        /** Draws the queued items — after a page break if they do not fit together with `need` (what must follow them). */
        const flushLead = (need: number, onStart?: () => void): void => {
          const total = lead.reduce((a, it) => a + it.h, 0) + need;
          if (needsBreak(cursorY, total, pageBox)) { doc.addPage(); cursorY = pdfMarginTop; }
          onStart?.();
          for (const it of lead) if (!(it.dropAtTop && atPageTop(cursorY, pageBox))) it.draw();
          lead.length = 0;
        };

        // ── Layout of one document (rendered in the host) ───────────────────────────────────
        const layoutDocument = async (job: PdfDocJob, ji: number, gapBefore: number) => {
          const headerText = titleOf(job);
          const titleLineH = titleFontSize * 1.15;
          // Where the document starts is known only after the keep-together decision (it may begin on a new page).
          let started = false;
          let headPage = 0;
          let firstLineRecorded = false;
          const onStart = () => { if (started) return; started = true; headPage = doc.getNumberOfPages(); docEntries.push({ job: ji, page: editionPage() }); docStart.push(headPage); };
          const flush = (need: number) => flushLead(need, onStart);
          if (gapBefore > 0) defer(gapBefore, () => { cursorY += gapBefore; }, true);
          if (multi && chapterFirst[ji] && chapterHeadings) {
            const drawChapter = () => drawChapterBlock(ji, textX, textColumnW, true);
            defer(dryRun(drawChapter), drawChapter);
          }
          // One document with a title page: the title stands there. Otherwise every document
          // gets its own heading (title, framed edition number, metadata line).
          const drawHead = () => {
            doc.setFontSize(titleFontSize);
            doc.setFont(fontFamily, "normal");
            if (multi) {
              // Several documents run on in one flow. A document begins with a hairline and one
              // heading line — framed edition number, then the fields set under Settings (default ID, reference, genre) — instead
              // of a page of its own.
              const fsH = pdfFontSize + 1;
              const lineHM = fsH * 1.25;
              if (cursorY > pdfMarginTop + 1 && !suppressDocRule) {
                doc.setDrawColor(PDF_KEY_GREY + 40, PDF_KEY_GREY + 40, PDF_KEY_GREY + 40);
                doc.setLineWidth(0.4);
                doc.line(textX, cursorY - fsH - 3, pageWidth - pdfMarginRight, cursorY - fsH - 3);
              }
              suppressDocRule = false;
              drawBox(boxTextOf(ji), cursorY, fsH);
              // the heading is whatever the settings list: fields, labels, styles
              flowHeading(headingParts(job.document, docHeadingFields, opts.settings, jobs.map((j) => j.document)), fsH);
              doc.setFont(fontFamily, 'normal');
              doc.setTextColor(0, 0, 0);
              cursorY += lineHM + 7;
            } else {
            // The framed number (see boxMode) stands in the left margin, level
            // with the first title line, as the chant numbers do in the printed edition.
            drawBox(boxTextOf(ji), cursorY, pdfFontSize);
            doc.setFontSize(titleFontSize);
            for (const line of doc.splitTextToSize(headerText, Math.max(60, pageWidth - pdfMarginRight - textX))) {
              checkPageOverflow(titleLineH);
              doc.text(line, textX, cursorY);
              cursorY += titleLineH;
            }
            cursorY += Math.max(0, pdfTitleVerticalSpace - titleLineH);
            checkPageOverflow(0);
            }

            // Metadata inline, styled & dense
            if (opts.includeMetadata && !multi) {
              doc.setFontSize(metaFontSize);
          
              // several documents: ID, incipit, genre and edition number are in the heading already
              const items = headingParts(job.document, docHeadingFields, opts.settings, jobs.map((j) => j.document))
                .map((p) => ({ label: p.label, val: p.text }));
              let curX = textX;
              let curY = cursorY;
              const rightEdge = pageWidth - pdfMarginRight;
              const lineH = metaFontSize * 1.4;

              // Draw text word by word, wrapping at the right margin (and across pages)
              // so long values like the Comment break automatically.
              // Tokenise into whitespace, Latin words, and individual CJK characters
              // (CJK has no spaces, so it must be able to wrap mid-run).
              const CJK = '\\u3000-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\uff00-\\uffef';
              const tokenRe = new RegExp(`[${CJK}]|\\s+|[^\\s${CJK}]+`, 'g');
              const drawWords = (text: string, style: 'bold' | 'normal', key = false) => {
                doc.setFont(fontFamily, style);
                // Keys ("ID:", "Initium:") stay in the background: light grey, regular weight.
                if (key) doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY); else doc.setTextColor(0, 0, 0);
                for (const w of (text.match(tokenRe) || [])) {
                  if (!w) continue;
                  const isSpace = /^\s+$/.test(w);
                  const ww = doc.getTextWidth(w);
                  if (!isSpace && curX + ww > rightEdge && curX > textX) {
                    curX = textX;
                    curY += lineH;
                    if (curY > maxContentY) { doc.addPage(); curY = pdfMarginTop; }
                  }
                  if (isSpace && curX === textX) continue; // no leading space on a wrapped line
                  doc.text(w, curX, curY);
                  curX += ww;
                }
              };

              for (let k = 0; k < items.length; k++) {
                if (items[k].label) drawWords(items[k].label + ": ", 'normal', true);
                drawWords(items[k].val, 'normal');
                if (k < items.length - 1) drawWords("   •   ", 'normal');
              }

              cursorY = curY + (multi ? 9 : pdfMetadataVerticalSpace);
              checkPageOverflow(0);
            }

          };
          if (!(useTitlePage && !multi)) defer(dryRun(drawHead), drawHead);
            // DOM Traversal for Structural Layout
            doc.setFontSize(12);
        
            // Comment spans are marked like in the printed edition: only the corners of a
            // horizontal bracket, in grey, around the lyric they refer to (the apparatus
            // cites that text instead of a number).
            // Brackets sit as close under the staff as they do under a lyric: 3 pt below the lowest
            // ink (the lyric's baseline, or the staff / lowest note of a system without text, which
            // ends 4 pt below its ink). The "bracket gap" setting adds to that distance.
            const bracketDrop = (hasLyrics: boolean) => hasLyrics ? pdfSyllableTextOffset + 3 : (compactTextless ? pdfBracketGap - 4 : pdfBracketGap);
            const drawActiveBracket = (startX: number, endX: number, bY: number, _label: string) => {
               const foot = Math.min(PDF_CORNER_FOOT, Math.max(1, (endX - startX) / 3));
               doc.setLineWidth(PDF_CORNER_WIDTH);
               doc.setDrawColor(PDF_CORNER_GREY, PDF_CORNER_GREY, PDF_CORNER_GREY);
               doc.line(startX, bY - PDF_CORNER_LEG, startX, bY);
               doc.line(startX, bY, startX + foot, bY);
               doc.line(endX, bY - PDF_CORNER_LEG, endX, bY);
               doc.line(endX - foot, bY, endX, bY);
            };
        
            // The document in print order, straight from the model
            const blocks = documentBlocks(job.cont);
            const firstSyllableUuid = VM.getSyllables(job.cont)[0]?.uuid ?? null;
        
            // Track active comments for drawing brackets
            const activeBrackets: { [key: string]: { startX: number, startLineY: number, label: string } } = {};
            const documentComments = printableComments(job.cont);
            const commentAnchors = new Set<string>(documentComments.flatMap((c: any) => [c.startUUID, c.endUUID]));
        
            // Build a map of Syllable/LinePart UUID to all its nested commentable UUIDs (including notes)
            const uuidMap: { [key: string]: string[] } = {};
            if (job.cont) {
                const allLineParts = VM.getAllLineParts(job.cont);
                for (const lp of allLineParts) {
                    uuidMap[lp.uuid] = VM.getCommentableUUIDsOfLinePart(lp);
                }
            }
        
            // Track the current Signatures to print before the next Zeile
            let currentSignatures: string[] = [];
            let wasLastElementParatext = false;
            let lastParatextBaselineY = 0;
            let paratextPending = false; // no staff drawn since the last paratext (structure rows in between don't count)
            let lastParatextPage = 0;

            for (let i = 0; i < blocks.length; i++) {
              const block = blocks[i];
              if (block.kind === 'formteil') {
                // a section: its signature goes in front of its first line; space before it
                if (block.signature) currentSignatures.push(block.signature);
                if (!wasLastElementParatext) defer(pdfVerticalSpace, () => { cursorY += pdfVerticalSpace; }, true);
                wasLastElementParatext = false;
                continue;
              }
              const zeile = block.kind === 'zeile' ? block.zeile : null;
              const parts = zeile ? printedParts(zeile) : [];
          
              if (zeile && parts.length > 0) {
                wasLastElementParatext = false;
                // Horizontal layout for notes and breaks
            
                const musicStartX = pdfMarginLeft + pdfSignaturSpace;
            
                let lineStartY = cursorY;
                let cursorX = musicStartX;
                let lineMaxHeight = 0;
                let lastContentEndX = musicStartX;
                let lineHasLyrics = false;
                let lineHasBrackets = Object.keys(activeBrackets).length > 0;
            
                // Pass 1: measure every part, then let the pure layout decide systems,
                // indents and clefs (see pdf-layout.ts).
                const measured = timedSync('measure', () => this.measureLineParts(zeile, {
                  doc, fontFamily, pdfFontSize, SCALE, extraSyllableSpacing, textOffset: pdfSyllableTextOffset, clefMode, firstSyllableUuid, textStyle: statusTextStyles[block.kind === 'zeile' ? block.status : ''], skipEmpty: skipEmptySyllables, keepUuids: commentAnchors,
                  formatFolio: (l) => formatFolioLabel(l, folioMode, foliated.get(chapterKeyOf(job)) ?? false),
                }));
                // All-caps syllables ("SA– LUS") are set in small capitals; the first letter of a
                // word stays full size, the continuation of a hyphenated word is all small. A status
                // style of "small capitals" does the same for lower-case text.
                let prevLyric = '';
                const lyricStyle = statusTextStyles[block.kind === 'zeile' ? block.status : ''];
                for (const m of measured) {
                  if (m.isMarker) continue;
                  const caps = m.txt ? capsModeFor(m.txt, lyricStyle, prevLyric) : undefined;
                  if (caps) {
                    m.smallCaps = caps;
                    m.lyricWidth = this.lyricWidth(doc, fontFamily, m.txt, pdfFontSize, m.smallCaps);
                    m.finalSecWidth = m.width = Math.max(m.svgWidth, m.lyricShift + m.lyricWidth + extraSyllableSpacing - 12 * SCALE);
                  }
                  if (m.txt) prevLyric = m.txt;
                }
                const layoutOpts = {
                  startX: musicStartX,
                  maxX: pageWidth - pdfMarginRight,
                  continuationIndent: pdfContinuationIndent,
                  clefWidth: PDF_CLEF_WIDTH * SCALE,
                  // a lone last syllable stays on its row rather than getting a system of its own
                  widowSlack,
                  // adiastematic lines have no staff, hence no clef either
                  clefMode: zeile.notation === 'adiastematic' ? 'document-start' as const : clefMode,
                };
                // Folio labels always stand at the right edge of the text block; they take no room in
                // the layout (see where they are drawn).
                const layout = layoutPdfLine(
                  measured.map((m, k) => ({
                    kind: m.isMarker ? 'marker' as const : 'syllable' as const,
                    width: m.width,
                    hasClef: m.hasClef,
                    breakAfterPreferred: !m.isMarker && measured[k + 1]?.isMarker === true,
                  })),
                  layoutOpts);
                const labelLeft = new Map<number, number>();   // per system: left end of the labels already set
                // Per system: tallest syllable plus the room needed for ledger lines below.
                const sysTrims = layout.systems.map((sys) => {
                  let t = Infinity;
                  for (let k = sys.first; k <= sys.last; k++) if (!measured[k].isMarker) t = Math.min(t, (measured[k].trimUnits || 0) * SCALE);
                  return Number.isFinite(t) ? t : 0;
                });
                const sysRawTops = layout.systems.map((sys) => {
                  for (let k = sys.first; k <= sys.last; k++) if (!measured[k].isMarker) return measured[k].rawTop ?? 10;
                  return 10;
                });
                const sysHeights = layout.systems.map((sys, si) => {
                  let h = 0, extra = 0, hBare = 0, hasText = false, hasTick = false;
                  for (let k = sys.first; k <= sys.last; k++) {
                    const mk = measured[k];
                    h = Math.max(h, mk.secHeight);
                    hBare = Math.max(hBare, mk.secHeightBare ?? mk.secHeight);
                    extra = Math.max(extra, mk.belowExtra || 0);
                    if (mk.txt) hasText = true;
                    if (mk.isMarker) hasTick = true;
                  }
                  if (h <= 0) return 0;
                  if (hasText || !compactTextless) return h + extra - sysTrims[si];
                  // No text: no lyric zone — the system ends just below the staff (or its lowest
                  // note), leaving room for the line-change strokes that hang under it.
                  const staffBottom = (80 - 10) * SCALE - sysTrims[si];
                  return Math.max(hBare - sysTrims[si], staffBottom + (hasTick ? pdfFontSize + 4 : 4));
                });
                // A system never starts so low that its lyrics would run into the bottom margin.
                const systemNeed = (si: number) => (sysHeights[si] || 30) + pdfSyllableTextOffset + pdfFontSize * 0.5;
                // Systems of one line stay together as far as typography asks (no single system alone
                // at the bottom or the top of a page); the headings and rubrics queued in front come with the first.
                const nSys = layout.systems.length;
                const sysHasText = layout.systems.map((sys) => measured.slice(sys.first, sys.last + 1).some((mm) => !!mm.txt));
                const systemAdvance = (si: number) => (sysHeights[si] || 30) + (sysHasText[si] ? pdfSyllableTextOffset + pdfFontSize : 8) + pdfStaffSpacing;
                const groupNeed = (k: number) => {
                  const last = Math.min(nSys, k + systemsToKeep(k, nSys)) - 1;
                  let t = systemNeed(last);
                  for (let q = k; q < last; q++) t += systemAdvance(q);
                  return t;
                };
                const hadLead = lead.length > 0;
                flush(groupNeed(0));
                const leadPage = hadLead ? doc.getNumberOfPages() : 0;
                lineStartY = cursorY;   // the queued items moved the cursor (or a page break did)
                const afterParatext = paratextPending;
                paratextPending = false;
                // Like the printed edition: the first system follows its rubric closely.
                if (afterParatext && lastParatextPage === doc.getNumberOfPages()) {
                  cursorY = Math.min(cursorY, lastParatextBaselineY + PDF_PARATEXT_BELOW);
                  lineStartY = cursorY;
                }
                if (cursorY + systemNeed(0) > maxContentY && cursorY > pdfMarginTop + 1) {
                  doc.addPage();
                  cursorY = pdfMarginTop;
                  lineStartY = cursorY;
                }
                // The staff is drawn once per system (and per voice), not per syllable.
                const adiastematicLine = zeile.notation === 'adiastematic';
                const sysVoices = layout.systems.map((sys) => {
                  let v = 1, step = 91;
                  for (let k = sys.first; k <= sys.last; k++) { const g = measured[k].geom; if (g && g.voices.length > v) { v = g.voices.length; step = measured[k].voiceStep; } }
                  return { v, step };
                });
                // A syllable of type "without notes" means: no staff lines in its cell (space unchanged,
                // no clef, no box). A normal syllable that merely has no notes keeps its lines.
                const isBare = (k: number) => hideBareStaff && !measured[k].isMarker && measured[k].geom?.isNormal === false;
                // Staff segments per system: runs of cells that are not bare (markers belong to the run before).
                const staffRuns = layout.systems.map((sys) => {
                  const runs: { x1: number; x2: number }[] = [];
                  let cur: { x1: number; x2: number } | null = null;
                  for (let k = sys.first; k <= sys.last; k++) {
                    const pl = layout.placed[k];
                    const x1 = pl.injectClef ? pl.clefX : pl.x;
                    const x2 = pl.x + measured[k].width;
                    if (isBare(k)) { cur = null; continue; }
                    if (measured[k].isMarker) { if (cur) cur.x2 = x2; continue; }   // a marker never starts a run
                    if (!cur) { cur = { x1, x2 }; runs.push(cur); } else cur.x2 = x2;
                  }
                  return runs;
                });
                let staffDrawn = -1;
                const ensureStaff = (si: number) => {
                  if (staffDrawn === si) return;
                  staffDrawn = si;
                  if (adiastematicLine) return;
                  const top = cursorY - (sysTrims[si] || 0) + (40 - sysRawTops[si]) * SCALE;
                  for (const run of staffRuns[si]) {
                    for (let v = 0; v < sysVoices[si].v; v++) drawStaff(doc, run.x1, run.x2, top + v * sysVoices[si].step * SCALE, SCALE, notationColor);
                  }
                };
                let curSystem = 0;
                const sysPage: number[] = [];   // page of each system, for the placement stats
                stats.systems += layout.systems.length;
                stats.clefs += measured.filter((m) => m.hasClef).length + layout.placed.filter((pl) => pl.injectClef).length;
            
                for (let j = 0; j < measured.length; j++) {
                  const m = measured[j];
                  const pl = layout.placed[j];
                  const trim = sysTrims[pl.system] || 0;
                  const lpKind = m.lp.kind;

                  // Print Signatur right-aligned before the first part of this line — also when that part is a
                  // line/folio marker (which must not swallow the signature of its section)
                  if (j === 0 && currentSignatures.length > 0) {
                      doc.setFont(fontFamily, "normal");
                      // A short signature stands at the left margin; a longer one is set right-aligned before the staff —
                      // smaller or in several lines if it would run off the page (it may use the margin, but not the page edge).
                      const sigRight = musicStartX - 6;
                      const sig = layoutSignature(currentSignatures.join(" "), sigRight - PDF_SIGNATURE_PAGE_EDGE, pdfFontSize, (t, sz) => { doc.setFontSize(sz); return doc.getTextWidth(t); });
                      doc.setFontSize(sig.size);
                      // Print edition: the signature's baseline sits ~2.9 pt above the bottom staff line; further lines stand above it.
                      const baseY = cursorY - trim + (80 - sysRawTops[pl.system]) * SCALE - 2.9;
                      sig.lines.forEach((line, li) => {
                        const w = doc.getTextWidth(line);
                        const x = sig.lines.length === 1 && pdfMarginLeft + w + 6 <= musicStartX ? pdfMarginLeft : sigRight - w;
                        doc.text(line, x, baseY - (sig.lines.length - 1 - li) * sig.size * 1.15);
                      });
                      doc.setFontSize(pdfFontSize);
                      currentSignatures = [];
                  }

              
                  if (lpKind === 'LineChange' || lpKind === 'FolioChange') {
                    // Manuscript line/folio breaks: a short vertical tick (or two, for a
                    // folio change) hanging just below the staff — matching the on-screen
                    // look. They must NOT wrap the PDF line; only ZeileContainer boundaries
                    // start a new staff line.
                    const isFolio = lpKind === 'FolioChange';
                    const gap = 3;
                    cursorX = pl.x;
                    ensureStaff(pl.system);   // the staff runs through the marker
                    const mx = cursorX + gap;
                    const h = sysHeights[pl.system] || lineMaxHeight || 24;
                    // Like the printed edition: a thin stroke set in the lyric row
                    // between two syllables (not hanging off the staff).
                    // without lyrics there is no lyric row: the stroke hangs right under the staff
                    const systemHasText = measured.some((mm, kk) => layout.placed[kk].system === pl.system && mm.txt);
                    const staffBottomY = cursorY - trim + (80 - sysRawTops[pl.system]) * SCALE;
                    const tickTop = systemHasText || !compactTextless ? cursorY + h + pdfSyllableTextOffset - pdfFontSize * 0.78 : staffBottomY + 3;
                    const tickBottom = tickTop + pdfFontSize * 0.98;
                    const tickGap = PDF_MARKER_TICK_GAP;
                    doc.setLineWidth(0.5);
                    doc.setDrawColor(notationColor[0], notationColor[1], notationColor[2]);
                    doc.line(mx, tickTop, mx, tickBottom);
                    let rightEdge = mx;
                    if (isFolio) {
                      doc.line(mx + tickGap, tickTop, mx + tickGap, tickBottom);
                      rightEdge = mx + tickGap;
                    }
                    doc.setLineWidth(0.2);
                    if (isFolio && m.folioLabel) {
                      const baselineY = tickBottom - pdfFontSize * 0.2;
                      doc.setFont(fontFamily, 'normal');
                      doc.setFontSize(pdfFontSize * 0.85);
                      // flush right with the text block; where the system runs to the edge the label
                      // hangs in the margin instead; several labels in one system stack leftwards
                      const lw = m.labelWidth || 0;
                      const fits = layout.systems[pl.system].endX + 8 <= layoutOpts.maxX - lw;
                      let lx = fits ? layoutOpts.maxX - lw : Math.min(layoutOpts.maxX + 6, pageWidth - 6 - lw);
                      const taken = labelLeft.get(pl.system);
                      if (taken !== undefined) lx = Math.min(lx, taken - 6 - lw);
                      labelLeft.set(pl.system, lx);
                      doc.text(m.folioLabel, lx, baselineY);
                      doc.setFontSize(pdfFontSize);
                    }
                    cursorX = rightEdge + gap + 2;
                    continue;
                  }
              
                  const { txt, secHeight, finalSecWidth } = m;
                  if (txt) lineHasLyrics = true;


                  const partUuid = m.lp.uuid;
                  const partUuids = partUuid ? (uuidMap[partUuid] || [partUuid]) : [];
              
                  // 1. Check if any comments start here
                  if (partUuids.length > 0) {
                      const startingComments = documentComments.filter((c: any) => partUuids.includes(c.startUUID));
                      if (startingComments.length > 0) {
                          lineHasBrackets = true;
                          for (let ci = 0; ci < startingComments.length; ci++) {
                              const c = startingComments[ci];
                              const key = `${c.startUUID}_${c.endUUID}`;
                              const idx = documentComments.indexOf(c) + 1;
                              activeBrackets[key] = { startX: pl.x + m.lyricShift - 1, startLineY: lineStartY, label: `[${idx}]` };
                          }
                      }
                  }
              
                  // Wrap to next line if it exceeds page width
                  if (pl.system !== curSystem) {
                     const bracketY = lineStartY + lineMaxHeight + bracketDrop(lineHasLyrics);
                     for (const key in activeBrackets) {
                         const b = activeBrackets[key];
                         drawActiveBracket(b.startX, lastContentEndX, bracketY, b.label);
                     }
                 
                     let lineBottomY = lineStartY + lineMaxHeight;
                     if (lineHasLyrics) {
                         lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
                     } else if (lineHasBrackets) {
                         lineBottomY = bracketY + 3;
                     }
                 
                     cursorY = lineBottomY + pdfStaffSpacing;
                          checkPageOverflow(groupNeed(pl.system));
                 
                     lineStartY = cursorY;
                     cursorX = pl.clefX;
                     curSystem = pl.system;
                     lineMaxHeight = 0;
                     // the syllable that opens the system may be the only one with a lyric
                     lineHasLyrics = !!txt;
                     lineHasBrackets = Object.keys(activeBrackets).length > 0;
                 
                     for (const key in activeBrackets) {
                         const b = activeBrackets[key];
                         b.startX = pl.x + m.lyricShift - 1;
                         b.startLineY = lineStartY;
                     }
                  }
              
                  lineMaxHeight = Math.max(lineMaxHeight, sysHeights[pl.system] || secHeight);
                  if (sysPage[pl.system] === undefined) sysPage[pl.system] = doc.getNumberOfPages();
                  ensureStaff(pl.system);
                  if (pl.injectClef && !isBare(j)) {
                    drawGClef(doc, pl.clefX, cursorY - trim + (40 - sysRawTops[pl.system]) * SCALE, SCALE, notationColor);
                  }
                  cursorX = pl.x;
              
                  // Notes, brackets, ledger lines and the clef, drawn directly from the geometry
                  if (m.geom) {
                    const g = m.geom;
                    timedSync('draw', () => {
                      drawSyllableNotation(doc, g, { cellX: cursorX, rawTopY: cursorY - trim, rawTop: sysRawTops[pl.system], S: SCALE, voiceStep: m.voiceStep }, notationColor);
                      if (g.showClef && g.isNormal) drawGClef(doc, cursorX, cursorY - trim + (40 - sysRawTops[pl.system]) * SCALE, SCALE, notationColor);
                    });
                  }
              
                  // Draw Syllable Text below the notes
                  if (txt) {
                    this.drawLyric(doc, fontFamily, txt, cursorX + m.lyricShift, cursorY + lineMaxHeight + pdfSyllableTextOffset, pdfFontSize, m.smallCaps);
                  }
              
                  // 2. Check if any comments end here
                  if (partUuids.length > 0) {
                      const endingComments = documentComments.filter((c: any) => partUuids.includes(c.endUUID));
                      if (endingComments.length > 0) {
                          lineHasBrackets = true;
                          for (let ci = 0; ci < endingComments.length; ci++) {
                              const c = endingComments[ci];
                              const key = `${c.startUUID}_${c.endUUID}`;
                              if (activeBrackets[key]) {
                                  const b = activeBrackets[key];
                                  const bracketY = lineStartY + lineMaxHeight + bracketDrop(lineHasLyrics);
                                  drawActiveBracket(b.startX, pl.x + m.lyricShift + (m.lyricWidth > 0 ? m.lyricWidth : Math.max(4, m.svgWidth - m.lyricShift - 4)) + 1, bracketY, b.label);
                                  delete activeBrackets[key];
                              }
                          }
                      }
                  }
              
                  lastContentEndX = pl.x + m.lyricShift + (m.lyricWidth > 0 ? m.lyricWidth : Math.max(4, m.svgWidth - m.lyricShift - 4)) + 1;
                  cursorX += finalSecWidth;
                }
            
                // Close active brackets at the very end of the ZeileContainer
                const bracketY = lineStartY + lineMaxHeight + bracketDrop(lineHasLyrics);
                for (const key in activeBrackets) {
                    const b = activeBrackets[key];
                    drawActiveBracket(b.startX, lastContentEndX, bracketY, b.label);
                    delete activeBrackets[key];
                }
            
                let lineBottomY = lineStartY + lineMaxHeight;
                if (lineHasLyrics) {
                    lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
                } else if (lineHasBrackets) {
                    lineBottomY = bracketY + 3;
                }
                cursorY = lineBottomY + pdfStaffSpacing;
                checkPageOverflow(0);
                stats.placement.lines.push({ job: ji, pages: sysPage.filter((q) => q !== undefined), leadPage });
                const firstPage = sysPage.find((q) => q !== undefined);   // a line of markers only has no system
                if (!firstLineRecorded && firstPage !== undefined) { firstLineRecorded = true; stats.placement.documents.push({ job: ji, head: headPage, firstSystem: firstPage }); }
            
              } else if (block.kind === 'paratext') {
                // Rubric / paratext
                const txt = block.text;
            
                if (txt) {
                  doc.setFontSize(pdfParatextFontSize);
                  doc.setFont(fontFamily, "normal");
              
                  const splitText = doc.splitTextToSize(txt, Math.max(60, pageWidth - pdfMarginRight - textX));
                  const ownNeed = splitText.length * pdfParatextFontSize * 1.4 + pdfParatextSpacing;
                  // Queued: a rubric (or a run of rubrics) must not be left alone at the bottom of a page —
                  // the first system that follows is placed with it.
                  defer(ownNeed, () => {
                    doc.setFontSize(pdfParatextFontSize);
                    doc.setFont(fontFamily, "normal");
                    doc.text(splitText, textX, cursorY);
                    lastParatextBaselineY = cursorY + (splitText.length - 1) * pdfParatextFontSize * doc.getLineHeightFactor();
                    lastParatextPage = doc.getNumberOfPages();
                    paratextPending = true;
                    cursorY += ownNeed;
                  });
                  wasLastElementParatext = true;
                }
              }
            }
            flush(0);   // a document that ends with queued items (rubrics, a heading without lines)

        };

        // ── Critical apparatus of one document ──────────────────────────────────────────────
        // ── Lines of notes outside the edition (comment trees, line comments) ──────────────
        // Drawn at the apparatus scale in one or more rows; `context` notes in grey.
        const inlineZeileBox = (zeile: VM.ZeileContainer, context: boolean, maxW: number): Box => {
          const Sc = pdfCommentStaffScale;
          const fs = pdfCommentFontSize - 1;      // lyrics under the small staves
          const adia = zeile.notation === 'adiastematic';
          type Item = { kind: 's'; g: SyllableGeometry; txt: string; w: number; shift: number } | { kind: 'm'; w: number; folio: boolean };
          const items: Item[] = printedParts(zeile).map((lp): Item => {
            if (lp.kind !== 'Syllable') return { kind: 'm', w: 7, folio: lp.kind === 'FolioChange' };
            const g = syllableGeometry(lp, { showClef: false, adiastematic: adia });
            let txt = (lp.text || '').trim();
            if (txt === 'X' || txt === '...' || txt === '<...>') txt = '';
            txt = txt.replace(/-$/, '\u2013');
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(fs);
            const tw = txt ? doc.getTextWidth(txt) : 0;
            const shift = g.shiftUnits >= 0 ? Math.max(0, g.shiftUnits - 0.5) * Sc : 0;
            return { kind: 's', g, txt, w: Math.max(g.widthUnits * Sc, shift + tw + 4), shift };
          });
          let minTop = 40, low = 80;
          for (const it of items) if (it.kind === 's') { minTop = Math.min(minTop, it.g.minTop); low = Math.max(low, ...it.g.lowest); }
          const head = Math.max(4, 40 - minTop + 2);
          const below = Math.max(10, low + 2 - 80);
          const hasText = items.some((it) => it.kind === 's' && !!it.txt);
          const rowH = (head + 40 + below) * Sc + (hasText ? fs * 1.15 : 0);
          const rows: Item[][] = [[]];
          let x = 0;
          for (const it of items) {
            if (x + it.w > maxW && rows[rows.length - 1].length) { rows.push([]); x = 0; }
            rows[rows.length - 1].push(it);
            x += it.w;
          }
          const rowW = (r: Item[]) => r.reduce((acc, it) => acc + it.w, 0);
          const color: RGB = context ? [165, 165, 165] : notationColor;
          return {
            w: Math.max(0, ...rows.map(rowW)), h: rows.length * rowH + (rows.length - 1) * 2,
            anchor: (head + 20) * Sc,
            draw: (ox, oy) => rows.forEach((r, ri) => {
              const staffTop = oy + ri * (rowH + 2) + head * Sc;
              if (!adia) {
                // staff lines only through cells that are not of the type "without notes"
                let sx = ox, runStart: number | null = null;
                for (const it of r) {
                  const bare = it.kind === 's' && !it.g.isNormal;
                  if (bare) { if (runStart !== null) drawStaff(doc, runStart, sx, staffTop, Sc, color); runStart = null; }
                  else if (runStart === null) runStart = sx;
                  sx += it.w;
                }
                if (runStart !== null) drawStaff(doc, runStart, sx, staffTop, Sc, color);
              }
              let cx = ox;
              for (const it of r) {
                if (it.kind === 's') {
                  drawSyllableNotation(doc, it.g, { cellX: cx, rawTopY: staffTop, rawTop: 40, S: Sc, voiceStep: 91 }, color);
                  if (it.txt) {
                    doc.setFont(fontFamily, 'normal');
                    doc.setFontSize(fs);
                    if (context) doc.setTextColor(150, 150, 150); else doc.setTextColor(0, 0, 0);
                    doc.text(it.txt, cx + it.shift, staffTop + (40 + below) * Sc + fs * 0.8);
                    doc.setTextColor(0, 0, 0);
                  }
                } else {
                  const t = staffTop + (40 + below) * Sc;
                  doc.setDrawColor(color[0], color[1], color[2]);
                  doc.setLineWidth(0.4);
                  doc.line(cx + 3, t, cx + 3, t + fs);
                  if (it.folio) doc.line(cx + 5, t, cx + 5, t + fs);
                }
                cx += it.w;
              }
            }),
          };
        };

        // ── Critical apparatus of one document ──────────────────────────────────────────────
        const drawApparatusFor = async (job: PdfDocJob, ji: number) => {
          const jobParts = VM.getAllLineParts(job.cont);
          const hasComments = printableComments(job.cont).length > 0 || job.cont.globalComment;
          if (!hasComments) return;
            if (!apparatusStarted) {
                // the apparatus starts on a page of its own, after all editions
                doc.addPage();
                cursorY = pdfMarginTop;
                apparatusPage = editionPage();
                apparatusStarted = true;
                if (volumeParts) drawPartPage('Critical Apparatus');
                else cursorY = drawHeading('Critical Apparatus', textX, cursorY + 3, textColumnW, 10) + 2;
            }
            if (multi) {
                // Hierarchy like the printed apparatus: the manuscript (chapter heading), below it
                // each document — framed running number, ID, incipit, genre — and its entries.
                // Queued: they are drawn together with the first entry that follows.
                if (chapterFirst[ji] && chapterHeadings) {
                    const drawChapter = () => {
                        if (!dry) apHeadPage ||= doc.getNumberOfPages();
                        cursorY += 10;
                        if (chapterRows && !dry) apparatusOutline.push({ label: chapterLabelOf(ji), depth: 1, job: ji, page: editionPage() });
                        drawChapterBlock(ji, textX, textColumnW, false);
                    };
                    defer(dryRun(drawChapter), drawChapter, true);
                }
                const fsD = pdfCommentFontSize + 1;
                defer(6 + fsD * 1.9 + 3, () => {
                    cursorY += 6;
                    apHeadPage ||= doc.getNumberOfPages();
                    drawBox(boxTextOf(ji), cursorY + fsD, fsD);
                    doc.setFontSize(fsD);
                    doc.setFont(fontFamily, 'bold');
                    doc.setTextColor(0, 0, 0);
                    const idText = job.document.dokumenten_id || '';
                    doc.text(idText, textX, cursorY + fsD);
                    let hx = textX + doc.getTextWidth(idText) + 8;
                    doc.setFont(fontFamily, 'italic');
                    const incipit = job.document.textinitium || '';
                    doc.text(incipit, hx, cursorY + fsD);
                    hx += doc.getTextWidth(incipit) + 8;
                    const gen = genreOf(job.document);
                    if (gen) {
                        doc.setFont(fontFamily, 'normal');
                        doc.setFontSize(pdfCommentFontSize);
                        doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
                        doc.text(gen, hx, cursorY + fsD);
                        doc.setTextColor(0, 0, 0);
                    }
                    cursorY += fsD * 1.9 + 3;
                    apparatusOutline.push({ label: [idText, incipit].filter(Boolean).join(' '), depth: chapterRows ? 2 : 1, job: ji, page: editionPage() });
                }, true);
            }
            let apHeadPage = 0;
            let apEntryRecorded = false;
            defer(0, () => { apparatusSpans.push({ job: ji, from: doc.getNumberOfPages() }); });

            // Text measuring/drawing and the comment-tree layout, all straight from the model.
            const textKit: TextKit = {
              width: (t, st, size) => { doc.setFont(fontFamily, st); doc.setFontSize(size); return doc.getTextWidth(t); },
              draw: (t, x, y, st, size, grey) => {
                doc.setFont(fontFamily, st);
                doc.setFontSize(size);
                if (grey) doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY); else doc.setTextColor(0, 0, 0);
                doc.text(t, x, y);
              },
              rect: (x, y, w, h) => { doc.setLineWidth(0.2); doc.setDrawColor(0, 0, 0); doc.rect(x, y, w, h); },
            };
            const treeKit: TreeKit = {
              ...textKit,
              fs: pdfCommentFontSize,
              lineH: pdfCommentFontSize * 1.38,
              maxCellW: textColumnW * 0.6,
              gapX: 6,
              gapY: 3,
              bracket: (x, y, h) => {
                // the bracket between a reading and its variant is dark in the printed volume (the grey corners belong to the edition)
                doc.setDrawColor(PDF_APPARATUS_BRACKET, PDF_APPARATUS_BRACKET, PDF_APPARATUS_BRACKET);
                doc.setLineWidth(0.55);
                doc.line(x, y, x + 3, y);
                doc.line(x + 3, y, x + 3, y + h);
                doc.line(x + 3, y + h, x, y + h);
              },
              notes: (zeile, context, maxW) => inlineZeileBox(zeile, context, maxW),
            };
            /** One entry of the apparatus: how high it is and how it is drawn. An entry is never split, and
             *  the headings queued in front of it are drawn with it (on a new page if they do not fit together). */
            type Entry = { h: number; /** baseline of the entry's first line, from its top */ labelY: number; draw: () => void };
            const place = (e: Entry): void => {
              flushLead(e.h);
              if (!apEntryRecorded) { apEntryRecorded = true; stats.placement.apparatus.push({ job: ji, head: apHeadPage || doc.getNumberOfPages(), entry: doc.getNumberOfPages() }); }
              e.draw();
            };

            // Plain-text comments are typeset directly: lemma, "]", then the comment with the
            // usual markup (plain = italic, ((quoted)) = roman, [[SIGLUM]] = bold small, {{boxed}}).
            const textEntry = (c: VM.Comment): Entry => {
                const fs = pdfCommentFontSize;
                const lh = fs * 1.38;
                type Seg = { w: string; style: 'normal' | 'italic' | 'bold'; size: number; grey?: boolean; boxed?: boolean; sep?: boolean };
                const segs: Seg[] = [];
                const lemma = commentLemma(jobParts, c);
                if (lemma) { segs.push({ w: lemma + ']', style: 'normal', size: fs }); }
                const cat = c.category ? (getCategoryDetails(c.category)?.label || '') : '';
                if (cat) segs.push({ w: cat + ':', style: 'italic', size: fs, grey: true });
                for (const token of (c.text || '').split(/(\(\(.*?\)\)|\{\{.*?\}\}|\[\[.*?\]\])/g)) {
                    if (!token) continue;
                    if (token.startsWith('((')) segs.push({ w: token.replace(/\(\(|\)\)/g, ''), style: 'normal', size: fs });
                    else if (token.startsWith('[[')) segs.push({ w: token.replace(/\[\[|\]\]/g, '').toUpperCase(), style: 'bold', size: fs - 1 });
                    else if (token.startsWith('{{')) segs.push({ w: token.replace(/\{\{|\}\}/g, ''), style: 'normal', size: fs, boxed: true });
                    else segs.push({ w: token, style: 'italic', size: fs });
                }
                if (c.emendation) segs.push({ w: '(em.)', style: 'italic', size: fs, grey: true });
                // lemma bracket, category label and the emendation mark are always set off by a space
                segs.forEach((sg, i) => { if (i > 0 && (/[\]:]$/.test(segs[i - 1].w) || sg.grey)) sg.sep = true; });

                // break into lines (words keep the style of their segment; glued words wrap together)
                const lines = breakLines(segs, textColumnW, textKit);
                const height = lines.length * lh;
                return { h: height, labelY: fs, draw: () => {
                lines.forEach((line, li) => {
                    let cx = textX;
                    const by = cursorY + fs + li * lh;
                    for (const word of line) {
                        cx += word.gapBefore;
                        doc.setFont(fontFamily, word.style); doc.setFontSize(word.size);
                        if (word.grey) doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY); else doc.setTextColor(0, 0, 0);
                        doc.text(word.w, cx, by);
                        if (word.boxed) { doc.setLineWidth(0.2); doc.setDrawColor(0, 0, 0); doc.rect(cx - 1, by - word.size, word.width + 2, word.size + 2); }
                        cx += word.width;
                    }
                });
                doc.setTextColor(0, 0, 0);
                cursorY += height + pdfCommentBlockGap;
                } };
            };


            // An entry whose body is a comment tree or a set of lines: like the printed apparatus the
            // lemma stands in a narrow left column, level with the staff, and the body to its right.
            const LEMMA_COL_MAX = lemmaColumnMax;
            const lemmaOf = (c: VM.Comment) => {
              const l = commentLemma(jobParts, c);
              // as in the printed volume the reading stands once: when the tree's first cell gives it
              // ("reading (note) ] variant"), the lemma column is left out
              if (c.tree && (treeRepeatsLemma(c.tree, l) || treeStartsWithTextedNotes(c.tree))) return '';
              // a tree that begins with its bracket ("uatis ] korrigiert aus uatum"): that bracket closes the lemma
              if (c.tree && treeStartsWithBracket(c.tree)) return l;
              return l ? l + ']' : '';
            };
            const lemmaColW = (c: VM.Comment): number => {
              const t = lemmaOf(c);
              if (!t) return 0;
              const w = textKit.width(t, 'normal', pdfCommentFontSize) + 8;
              return w <= LEMMA_COL_MAX ? Math.max(w, 26) : 0;   // longer: above the body
            };
            const structuredEntry = (c: VM.Comment, makeBody: (maxW: number) => Box): Entry => {
              const colW = lemmaColW(c);
              const lemma = lemmaOf(c);
              const body = makeBody(textColumnW - colW - 4);
              const above = !!lemma && colW === 0;
              // a long lemma stands above the body and wraps like text
              const lemmaLines = above ? breakLines([{ w: lemma, style: 'normal', size: pdfCommentFontSize }], textColumnW, textKit) : [];
              const aboveH = above ? lemmaLines.length * pdfCommentFontSize * 1.38 : 0;
              const mid = body.anchor ?? pdfCommentFontSize * 0.7;
              return { h: aboveH + body.h, labelY: above ? pdfCommentFontSize : mid + pdfCommentFontSize * 0.33, draw: () => {
              if (lemma) {
                if (above) drawLines(lemmaLines, textX, cursorY + pdfCommentFontSize, pdfCommentFontSize * 1.38, textKit);
                else textKit.draw(lemma, textX, cursorY + mid + pdfCommentFontSize * 0.33, 'normal', pdfCommentFontSize);
              }
              body.draw(textX + colW + (above ? 8 : 0), cursorY + aboveH, body.h);
              cursorY += aboveH + body.h + pdfCommentBlockGap - 1;
              } };
            };
            const linesBox = (c: VM.Comment, maxW: number): Box => {
              // witness siglum in a left column, its notes / text to the right (as printed)
              const sigFs = pdfCommentFontSize - 0.5;
              const sigs = (c.lines || []).map((_: any, j: number) => c.readingWitnesses?.[j] || '');
              const sigW = Math.max(0, ...sigs.map((sg) => (sg ? textKit.width(sg, 'bold', sigFs) + 8 : 0)));
              const parts: { sig: string; box: Box }[] = [];
              (c.lines || []).forEach((line: any, j: number) => {
                let box: Box | null = null;
                if (line.kind === VM.ContainerKind.ZeileContainer) box = inlineZeileBox(line, false, maxW - sigW);
                else if (line.kind === VM.ContainerKind.ParatextContainer && line.text) {
                  const ls = breakLines([{ w: line.text, style: 'italic', size: pdfCommentFontSize }], maxW - sigW, textKit);
                  box = { w: linesWidth(ls), h: ls.length * pdfCommentFontSize * 1.38, anchor: pdfCommentFontSize * 0.7, draw: (x, y) => drawLines(ls, x, y + pdfCommentFontSize, pdfCommentFontSize * 1.38, textKit) };
                }
                if (box) parts.push({ sig: sigs[j], box });
              });
              const h = parts.reduce((acc, p) => acc + p.box.h + 2, -2);
              return {
                w: sigW + Math.max(0, ...parts.map((p) => p.box.w)), h: Math.max(0, h), anchor: parts[0]?.box.anchor,
                draw: (x, y) => {
                  let cy = y;
                  for (const p of parts) {
                    if (p.sig) textKit.draw(p.sig, x, cy + (p.box.anchor ?? sigFs * 0.7) + sigFs * 0.33, 'bold', sigFs);
                    p.box.draw(x + sigW, cy, p.box.h);
                    cy += p.box.h + 2;
                  }
                },
              };
            };

            if (job.cont.globalComment) {
              // The comment on the whole document, without a label of its own (the printed volume has none).
              const box = layoutCommentTree(job.cont.globalComment, treeKit, textColumnW);
              if (box.h > 0) place({ h: box.h, labelY: 0, draw: () => { box.draw(textX, cursorY, box.h); cursorY += box.h + pdfCommentBlockGap + 2; } });
            }
            const ordered = printableComments(job.cont)
              .map((c, i) => ({ c, i, pos: commentStartIndex(jobParts, c) }))
              .sort((x, y) => (x.pos - y.pos) || (x.i - y.i));
            // As in the printed volume the signature of a section (A, B, 23, ...) stands in the margin in front of its first entry.
            const drawSignature = (text: string, baseline: number): void => {
              doc.setFont(fontFamily, 'normal');
              const sig = layoutSignature(text, textX - pdfMarginLeft - 4, pdfFontSize, (t, sz) => { doc.setFontSize(sz); return doc.getTextWidth(t); });
              doc.setFontSize(sig.size);
              doc.setTextColor(0, 0, 0);
              sig.lines.forEach((line, li) => doc.text(line, pdfMarginLeft, baseline - (sig.lines.length - 1 - li) * sig.size * 1.15));
              doc.setFontSize(pdfFontSize);
            };
            let lastSignature = '';
            for (const { c } of ordered) {
              const type = commentType(c);
              const entry = type === 'tree' && c.tree ? structuredEntry(c, (w) => layoutCommentTree(c.tree!, treeKit, w))
                : type === 'lines' && c.lines ? structuredEntry(c, (w) => linesBox(c, w))
                : textEntry(c);
              const signature = commentSignature(job.cont, c);
              const label = signature && signature !== lastSignature ? signature : '';
              lastSignature = signature;
              place(label ? { ...entry, draw: () => { drawSignature(label, cursorY + entry.labelY); entry.draw(); } } : entry);
            }
            flushLead(0);   // headings of a document whose comments drew nothing
        };

        // ── Source descriptions (Markdown), appended after the editions and the apparatus ────
        let descriptionStarted = false;
        let descriptionPage = 0;
        let descriptionTitle = 'Source Description';
        const descriptionOutline: { label: string; job: number; page: number }[] = [];
        const mdMeasure = (t: string, st: FontStyle, size: number): number => {
          doc.setFont(fontFamily, st);
          doc.setFontSize(size);
          return doc.getTextWidth(t);
        };
        let mdQuoteBars: number[] = [];   // x of the rules of the block quotes around the text being drawn
        const mdImages = new Map<string, LoadedImage | null>();
        /** Draws already broken lines from `top` on, aligned within `width`; moves nothing and breaks no page. */
        const drawMdLines = (lines: MdLine[], x: number, top: number, width: number, size: number, lh: number, align: 'left' | 'center' | 'right' = 'left'): void => {
          lines.forEach((line, li) => {
            const by = top + li * lh + size;
            const free = width - lineWidth(line);
            const dx = align === 'center' ? free / 2 : align === 'right' ? free : 0;
            for (const p of line) {
              doc.setFont(fontFamily, p.style);
              doc.setFontSize(size);
              if (p.grey) doc.setTextColor(PDF_KEY_GREY - 40, PDF_KEY_GREY - 40, PDF_KEY_GREY - 40); else doc.setTextColor(0, 0, 0);
              doc.text(p.text, x + dx + p.x, by);
              const url = p.href ? safeHref(p.href) : null;
              if (url) {
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.3);
                doc.line(x + dx + p.x, by + 1.3, x + dx + p.x + p.width, by + 1.3);
                doc.link(x + dx + p.x, by - size, p.width, size + 2, { url });
              }
            }
          });
          doc.setTextColor(0, 0, 0);
        };
        /** One run of inline text, breaking lines and pages as needed. `marker` hangs in front of the first line. */
        const drawMdFlow = (ins: MdInline[], x: number, width: number, size: number, o: { bold?: boolean; marker?: string; align?: 'left' | 'center' | 'right' } = {}): void => {
          const lh = size * 1.38;
          const lines = layoutInlines(ins, size, width, mdMeasure, { bold: o.bold });
          lines.forEach((line, li) => {
            checkPageOverflow(lh);
            doc.setDrawColor(PDF_CORNER_GREY, PDF_CORNER_GREY, PDF_CORNER_GREY);
            doc.setLineWidth(0.8);
            for (const bx of mdQuoteBars) doc.line(bx, cursorY + 1, bx, cursorY + lh);
            if (li === 0 && o.marker) {
              doc.setFont(fontFamily, 'normal');
              doc.setFontSize(size);
              doc.setTextColor(0, 0, 0);
              doc.text(o.marker, x - 4 - doc.getTextWidth(o.marker), cursorY + size);
            }
            drawMdLines([line], x, cursorY, width, size, lh, o.align);
            cursorY += lh;
          });
        };
        /** A table: column widths from the text (natural if it fits, else shared out), header repeated on every page. */
        const drawMdTable = (b: Extract<MdBlock, { kind: 'table' }>, x: number, width: number, fs: number): void => {
          const size = fs - 0.5;
          const lh = size * 1.32;
          const padX = 3.5;
          const padY = 2.2;
          const n = b.head.length;
          const all = [b.head, ...b.rows];
          const natural = (c: MdInline[], bold: boolean) => { const l = layoutInlines(c, size, 1e5, mdMeasure, { bold }); return l[0] ? lineWidth(l[0]) : 0; };
          const longest = (c: MdInline[], bold: boolean) => Math.max(0, ...c.flatMap((i) => i.t.split(/\s+/).map((w) => mdMeasure(w, bold || i.bold ? 'bold' : i.italic ? 'italic' : 'normal', size))));
          const maxW = Array.from({ length: n }, (_, k) => Math.max(...all.map((r, ri) => natural(r[k], ri === 0))));
          const minW = Array.from({ length: n }, (_, k) => Math.max(8, ...all.map((r, ri) => longest(r[k], ri === 0))));
          const inner = Math.max(n * 10, width - n * 2 * padX);
          const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
          let colW: number[];
          if (sum(maxW) <= inner) colW = maxW;
          else if (sum(minW) >= inner) colW = minW.map((m) => (inner * m) / sum(minW));
          else {
            const room = inner - sum(minW);
            const want = maxW.map((m, k) => m - minW[k]);
            colW = minW.map((m, k) => m + (room * want[k]) / Math.max(1, sum(want)));
          }
          const colX: number[] = [];
          let cx = x;
          for (const w of colW) { colX.push(cx + padX); cx += w + 2 * padX; }
          const tableW = cx - x;
          const layoutRow = (r: MdInline[][], head: boolean) => {
            const cells = r.map((c, k) => layoutInlines(c, size, colW[k], mdMeasure, { bold: head }));
            return { cells, h: Math.max(1, ...cells.map((l) => l.length)) * lh + 2 * padY };
          };
          const rule = (y: number, w: number, grey: number) => {
            doc.setDrawColor(grey, grey, grey);
            doc.setLineWidth(w);
            doc.line(x, y, x + tableW, y);
          };
          const drawRow = (row: { cells: MdLine[][]; h: number }) => {
            row.cells.forEach((lines, k) => drawMdLines(lines, colX[k], cursorY + padY, colW[k], size, lh, b.align[k] ?? 'left'));
            cursorY += row.h;
          };
          const head = layoutRow(b.head, true);
          const body = b.rows.map((r) => layoutRow(r, false));
          const startPage = (): void => {
            rule(cursorY, 0.7, 0);
            drawRow(head);
            rule(cursorY, 0.5, 0);
          };
          checkPageOverflow(head.h + (body[0]?.h ?? 0) + 4);
          startPage();
          body.forEach((row, ri) => {
            if (cursorY + row.h > maxContentY) {
              doc.addPage();
              cursorY = pdfMarginTop;
              startPage();
            }
            drawRow(row);
            if (ri < body.length - 1) rule(cursorY, 0.25, 190);
          });
          rule(cursorY, 0.7, 0);
          cursorY += fs * 0.7;
        };
        const drawMdBlocks = (blocks: MdBlock[], x: number, width: number, fs: number): void => {
          blocks.forEach((b, bi) => {
            const gap = fs * 0.6;
            switch (b.kind) {
              case 'heading': {
                const size = fs + (b.level === 1 ? 3 : b.level === 2 ? 1.5 : 0.5);
                if (bi > 0) cursorY += size * 0.7;
                checkPageOverflow(size * 1.25 + fs * 1.38 * 2);    // a heading never ends a page alone
                drawMdFlow(b.inlines, x, width, size, { bold: true });
                cursorY += size * 0.2;
                break;
              }
              case 'paragraph':
                drawMdFlow(b.inlines, x, width, fs);
                cursorY += gap;
                break;
              case 'quote':
                mdQuoteBars = [...mdQuoteBars, x + 2];
                drawMdBlocks(b.blocks, x + 12, width - 12, fs);
                mdQuoteBars = mdQuoteBars.slice(0, -1);
                break;
              case 'code': {
                doc.setFont(fontFamily, 'normal');
                doc.setFontSize(fs - 0.5);
                for (const raw of b.text.split('\n')) {
                  const parts: string[] = doc.splitTextToSize(raw || ' ', width - 8);
                  for (const part of parts) {
                    checkPageOverflow(fs * 1.3);
                    doc.setFont(fontFamily, 'normal');
                    doc.setFontSize(fs - 0.5);
                    doc.setTextColor(PDF_KEY_GREY - 40, PDF_KEY_GREY - 40, PDF_KEY_GREY - 40);
                    doc.text(part, x + 8, cursorY + fs);
                    cursorY += fs * 1.3;
                  }
                }
                doc.setTextColor(0, 0, 0);
                cursorY += gap;
                break;
              }
              case 'table':
                drawMdTable(b, x, width, fs);
                break;
              case 'image': {
                const img = mdImages.get(b.src);
                const cap = b.title || b.alt;
                if (!img) {
                  drawMdFlow([{ t: '[image: ' + (b.alt || 'not available') + ']', italic: true }], x, width, fs);
                  cursorY += gap;
                  break;
                }
                // at its own size (96 dpi), shrunk to the column and to most of a page
                let w = Math.min(width, img.w * 0.75);
                let h = (w * img.h) / img.w;
                const maxH = (maxContentY - pdfMarginTop) * 0.8;
                if (h > maxH) { h = maxH; w = (h * img.w) / img.h; }
                const capSize = fs - 1;
                const capLines = cap ? layoutInlines([{ t: cap, italic: true }], capSize, width, mdMeasure) : [];
                checkPageOverflow(h + 3 + capLines.length * capSize * 1.38);
                doc.addImage(img.data, img.format, x + (width - w) / 2, cursorY, w, h, undefined, 'FAST');
                cursorY += h + 3;
                if (cap) drawMdFlow([{ t: cap, italic: true }], x, width, capSize, { align: 'center' });
                cursorY += gap;
                break;
              }
              case 'rule':
                checkPageOverflow(10);
                doc.setDrawColor(PDF_KEY_GREY + 40, PDF_KEY_GREY + 40, PDF_KEY_GREY + 40);
                doc.setLineWidth(0.4);
                doc.line(x, cursorY + 4, x + width, cursorY + 4);
                cursorY += 10;
                break;
              case 'list': {
                const indent = fs * 1.7;
                b.items.forEach((it, k) => {
                  drawMdFlow(it.inlines, x + indent, width - indent, fs, { marker: b.ordered ? (b.start + k) + '.' : '•' });
                  cursorY += fs * 0.2;
                  drawMdBlocks(it.blocks, x + indent, width - indent, fs);
                });
                cursorY += gap * 0.6;
                break;
              }
            }
          });
        };
        const imageSources = (blocks: MdBlock[], into: Set<string>): void => {
          for (const b of blocks) {
            if (b.kind === 'image') into.add(b.src);
            else if (b.kind === 'quote') imageSources(b.blocks, into);
            else if (b.kind === 'list') for (const it of b.items) imageSources(it.blocks, into);
          }
        };
        const drawDescriptions = async (): Promise<void> => {
          const withText: { job: number; blocks: MdBlock[] }[] = [];
          const seen = new Set<string>();
          jobs.forEach((job, ji) => {
            const key = chapterKeyOf(job);
            if (seen.has(key)) return;
            seen.add(key);
            const blocks = parseMarkdown(sourceDescription(job.source));
            if (blocks.length) withText.push({ job: ji, blocks });
          });
          if (!withText.length) return;
          // pictures are fetched first, so that drawing can stay in one go
          const srcs = new Set<string>();
          for (const w of withText) imageSources(w.blocks, srcs);
          await Promise.all([...srcs].map(async (src) => { mdImages.set(src, await loadImage(src)); }));
          descriptionTitle = withText.length > 1 ? 'Source Descriptions' : 'Source Description';
          doc.addPage();
          cursorY = pdfMarginTop;
          descriptionPage = editionPage();
          descriptionStarted = true;
          if (volumeParts) drawPartPage(descriptionTitle);
          else cursorY = drawHeading(descriptionTitle, textX, cursorY + 3, textColumnW, 10) + 2;
          withText.forEach(({ job: ji, blocks }, k) => {
            if (multi) {
              // the manuscript as a chapter heading, like in the apparatus
              checkPageOverflow(80);
              if (k > 0) cursorY += 14;
              cursorY += 10;
              descriptionOutline.push({ label: chapterLabelOf(ji), job: ji, page: editionPage() });
              drawChapterBlock(ji, textX, textColumnW, false);
            } else checkPageOverflow(60);
            apparatusSpans.push({ job: ji, from: doc.getNumberOfPages() });   // the running head names this manuscript
            mdQuoteBars = [];
            drawMdBlocks(blocks, textX, textColumnW, pdfFontSize - 1);
          });
        };

        // ── Notation documentation: per manuscript the neume table and strips of the lines its signs stand in ──
        let notationStarted = false;
        let notationPage = 0;
        const notationOutline: { label: string; job: number; page: number }[] = [];
        const notationProblems: string[] = [];
        const notationSetup = readSetup(opts.settings);
        const notationDocOf = (job: PdfDocJob): NotationDoc => buildNotationDoc(job.source || {}, notationSetup);
        const hasNotation = (nd: NotationDoc) => nd.rows.length > 0 || nd.strips.length > 0;
        const drawNotations = async (): Promise<void> => {
          const withDoc: { job: number; nd: NotationDoc }[] = [];
          const seen = new Set<string>();
          jobs.forEach((job, ji) => {
            const key = chapterKeyOf(job);
            if (seen.has(key)) return;
            seen.add(key);
            const nd = notationDocOf(job);
            if (hasNotation(nd)) withDoc.push({ job: ji, nd });
          });
          if (!withDoc.length) return;
          doc.addPage();
          cursorY = pdfMarginTop;
          notationPage = editionPage();
          notationStarted = true;
          if (volumeParts) drawPartPage(NOTATION_TEXT.part);
          else cursorY = drawHeading(NOTATION_TEXT.part, textX, cursorY + 3, textColumnW, 10) + 2;
          const host: NotationHost = {
            doc, fontFamily, fs: pdfFontSize - 1, x: textX, width: textColumnW, top: pdfMarginTop, bottom: maxContentY,
            newPage: () => { doc.addPage(); cursorY = pdfMarginTop; return pdfMarginTop; },
          };
          for (let k = 0; k < withDoc.length; k++) {
            const { job: ji, nd } = withDoc[k];
            const job = jobs[ji];
            opts.onProgress?.('Notation ' + siglumOf(ji), k, withDoc.length);
            // the images are fetched first; a manuscript starts on a page of its own, as in the printed volume
            const { pictures, problems } = await loadStripPictures(nd.strips, (job.source as any)?.iiifManifestUrl,
              (d, t) => opts.onProgress?.(`Notation ${siglumOf(ji)}: strip ${d} of ${t}`, k, withDoc.length),
              await loadStripImages((job.source as any)?.id));
            for (const p of problems) notationProblems.push(`${siglumOf(ji) || 'Manuscript'}: ${p}`);
            if (k > 0) { doc.addPage(); cursorY = pdfMarginTop; }
            if (multi) {
              cursorY += 10;
              notationOutline.push({ label: chapterLabelOf(ji), job: ji, page: editionPage() });
              drawChapterBlock(ji, textX, textColumnW, false);
            }
            apparatusSpans.push({ job: ji, from: doc.getNumberOfPages() });   // the running head names this manuscript
            cursorY += 4;
            if (nd.rows.length) {
              cursorY = drawSubheading(host, NOTATION_TEXT.equivalents, cursorY);
              cursorY = drawEquivalents(host, nd, cursorY);
            }
            cursorY = drawNotes(host, nd, notationNotes(job.source), cursorY);
            if (opts.neumeTree && nd.rows.length) {
              cursorY = drawNeumeTree(host, nd.rows.map(r => r.pattern), cursorY + 16, NOTATION_TEXT.tree);
            }
            if (nd.strips.length) {
              cursorY = drawStrips(host, nd.strips, pictures, cursorY + 16, NOTATION_TEXT.inventory);
            }
          }
        };

        // ── Render, lay out, then the apparatus ─────────────────────────────────────────────
        // Volume style needs more than one part: the edition plus an apparatus or descriptions that exist.
        {
          const hasApparatus = !!opts.apparatus && jobs.some((j) => printableComments(j.cont).length > 0 || j.cont.globalComment);
          const hasDescriptions = !!opts.sourceDescriptions && jobs.some((j) => parseMarkdown(sourceDescription(j.source)).length > 0);
          const hasNotationDocs = !!opts.notationDocumentation && jobs.some((j) => hasNotation(notationDocOf(j)));
          multiPart = hasApparatus || hasDescriptions || hasNotationDocs;
          volumeParts = partStyle === 'volume' && multiPart;
          if (volumeParts) drawPartPage('Edition');
        }
        for (let ji = 0; ji < jobs.length; ji++) {
          opts.onProgress?.('Rendering ' + (jobs[ji].document.dokumenten_id || jobs[ji].document.textinitium || ''), ji, jobs.length);
          let gap = 0;
          if (multi && chapterFirst[ji] && chapterNewPage) {
            // a manuscript starts a new page with its chapter heading
            if (ji > 0) { doc.addPage(); cursorY = pdfMarginTop; }
          } else if (ji > 0) {
            if (opts.newPagePerDocument) { doc.addPage(); cursorY = pdfMarginTop; }
            // otherwise the next document follows with a gap (left out at the top of a page); its headings,
            // metadata and first system are kept together by `layoutDocument`
            else gap = pdfVerticalSpace * 2 + 6;
          }
          await layoutDocument(jobs[ji], ji, gap);
        }
        if (opts.apparatus) {
          for (let ji = 0; ji < jobs.length; ji++) {
            opts.onProgress?.('Apparatus ' + (jobs[ji].document.dokumenten_id || ''), ji, jobs.length);
            await drawApparatusFor(jobs[ji], ji);
          }
        }
        if (opts.sourceDescriptions) {
          opts.onProgress?.('Source description', jobs.length, jobs.length);
          await drawDescriptions();
        }
        if (opts.notationDocumentation) {
          opts.onProgress?.('Notation documentation', jobs.length, jobs.length);
          await drawNotations();
        }
        stats.documents = docEntries.map((e) => ({ id: jobs[e.job].document.dokumenten_id || '', page: e.page }));
        stats.apparatusPage = apparatusStarted ? apparatusPage : 0;
        stats.descriptionPage = descriptionStarted ? descriptionPage : 0;
        stats.notationPage = notationStarted ? notationPage : 0;
        stats.notationProblems = notationProblems;

        // ── Title page: title, source and — for one document — its metadata table, for several
        //    documents the contents table (ID, incipit, genre, page) ─────────────────────────────
        if (opts.cover) {
          doc.setPage(1);
          drawCover(doc, opts.cover.template, makeLookup(jobs, opts.settings, opts.cover.template.variables, { titel: opts.title, gruppe: opts.cover.group, gruppenfeld: opts.cover.groupField, gruppenteile: opts.cover.groupParts }), fontFamily);
        }
        if (useTitlePage) {
          const cx = pageWidth / 2;
          const keyX = cx - 9;
          const valX = cx + 9;
          const valW = Math.max(60, pageWidth - pdfMarginRight - valX);
          const startNewTitlePage = (): number => {
            const target = titlePageCount + 1;
            doc.insertPage(target);      // behind the existing title pages, before the edition
            titlePageCount++;
            doc.setPage(target);
            return pdfMarginTop + 10;
          };
          doc.setPage(coverPages + 1);
          // Several documents: no automatic title block — only a title of one's own, if one was given
          // (the contents then start at the top of the page). The cover carries the title already.
          const ownTitle = multi && !opts.cover ? (opts.title || '').trim() : '';
          let y = multi && !ownTitle ? pdfMarginTop + 10 : Math.max(pdfMarginTop + 30, pageHeight * 0.17);
          doc.setTextColor(0, 0, 0);
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(PDF_TITLE_PAGE_SIZE);
          if (!multi || ownTitle) {
            const mainTitle = multi ? ownTitle : titleOf(jobs[0]);
            for (const line of doc.splitTextToSize(mainTitle, printWidth - 60)) {
              doc.text(line, cx, y, { align: 'center' });
              y += PDF_TITLE_PAGE_SIZE * 1.22;
            }
            if (!multi) {
              const subtitle = headOf(0);
              if (subtitle && subtitle !== mainTitle) {
                y += 4;
                doc.setFontSize(pdfFontSize + 1);
                doc.setTextColor(PDF_KEY_GREY - 30, PDF_KEY_GREY - 30, PDF_KEY_GREY - 30);
                doc.text(subtitle, cx, y, { align: 'center' });
                y += 10;
              }
            }
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.5);
            doc.line(cx - 22, y, cx + 22, y);
            y += 34;
          }

          if (!multi && opts.includeMetadata) {
            // One document: its metadata as a quiet two-column table (keys light grey, right-aligned).
            for (const item of inlineMetadataItems(jobs[0].document, opts.settings)) {
              doc.setFontSize(metaFontSize + 0.5);
              const lines: string[] = doc.splitTextToSize(String(item.val), valW);
              const rowH = lines.length * (metaFontSize + 0.5) * 1.35 + 3;
              if (y + rowH > maxContentY) y = startNewTitlePage();
              doc.setFont(fontFamily, 'normal');
              doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
              doc.text(item.label, keyX, y, { align: 'right' });
              doc.setTextColor(0, 0, 0);
              lines.forEach((l, li) => doc.text(l, valX, y + li * (metaFontSize + 0.5) * 1.35));
              y += rowH;
            }
          }

          if (multi && opts.contents !== false) {
            // Contents: one row per document — ID, incipit, genre (light grey) — with dot leaders
            // and the page the document starts on; the apparatus is listed after them.
            // Hierarchy as in the printed volume's contents: part (Edition / Critical Apparatus) >
            // manuscript (chapter) > documents, each with the framed running number.
            type Row = { id: string; incipit: string; genre: string; page: number; plain?: boolean; chapter?: boolean; indent: number; depth: number; num?: string; bookmarkOnly?: boolean };
            const rows: Row[] = [];
            const docIndent = chapterRows ? 24 : 12;
            const docDepth = chapterRows ? 2 : 1;
            // the contents list the manuscripts only, like the printed volume; the documents stay in the bookmarks
            const manuscriptsOnly = contentsEdition !== 'documents';
            rows.push({ id: '', incipit: 'Edition', genre: '', page: (docEntries[0]?.page ?? 1) - (volumeParts ? 1 : 0), plain: true, chapter: true, indent: 0, depth: 0 });
            docEntries.forEach((e) => {
              const j = jobs[e.job];
              if (chapterRows && chapterFirst[e.job]) rows.push({ id: '', incipit: chapterLabelOf(e.job), genre: '', page: e.page, plain: true, indent: 12, depth: 1 });
              rows.push({ id: j.document.dokumenten_id || '', incipit: j.document.textinitium || '', genre: genreOf(j.document), page: e.page, indent: docIndent, depth: docDepth, num: boxTextOf(e.job), bookmarkOnly: manuscriptsOnly });
            });
            if (apparatusStarted) {
              rows.push({ id: '', incipit: 'Critical Apparatus', genre: '', page: apparatusPage, plain: true, chapter: true, indent: 0, depth: 0 });
              for (const ao of apparatusOutline) {
                if (ao.depth === 1 && chapterRows) rows.push({ id: '', incipit: ao.label, genre: '', page: ao.page, plain: true, indent: 12, depth: 1, bookmarkOnly: contentsApparatus === 'none' });
                else {
                  const j = jobs[ao.job];
                  rows.push({ id: j.document.dokumenten_id || '', incipit: j.document.textinitium || '', genre: genreOf(j.document), page: ao.page, indent: docIndent, depth: docDepth, num: boxTextOf(ao.job), bookmarkOnly: contentsApparatus !== 'documents' });
                }
              }
            }
            if (descriptionStarted) {
              rows.push({ id: '', incipit: descriptionTitle, genre: '', page: descriptionPage, plain: true, chapter: true, indent: 0, depth: 0 });
              if (chapterRows) for (const d of descriptionOutline) rows.push({ id: '', incipit: d.label, genre: '', page: d.page, plain: true, indent: 12, depth: 1 });
            }
            if (notationStarted) {
              rows.push({ id: '', incipit: NOTATION_TEXT.part, genre: '', page: notationPage, plain: true, chapter: true, indent: 0, depth: 0 });
              if (chapterRows) for (const d of notationOutline) rows.push({ id: '', incipit: d.label, genre: '', page: d.page, plain: true, indent: 12, depth: 1 });
            }
            if (y + 40 > maxContentY) y = startNewTitlePage();
            y = drawHeading('Contents', textX, y, textColumnW, 10) + 6;
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(pdfFontSize);
            const idW = Math.min(110, Math.max(0, ...rows.filter((r) => !r.plain).map((r) => doc.getTextWidth(r.id))) + 12);
            const lineH = pdfFontSize * 1.6;
            // The framed numbers share one width (the widest number), so that the IDs line up.
            doc.setFontSize(pdfFontSize - 1);
            const numBoxW = Math.max(12, ...rows.filter((q) => q.num).map((q) => doc.getTextWidth(q.num!) + 5));
            doc.setFontSize(pdfFontSize);
            for (const r of rows) {
              // the apparatus part lists manuscripts only (like the printed volume); its documents are
              // reachable through the bookmarks
              if (r.bookmarkOnly) {
                stats.outline.push({ label: [r.id, r.incipit, r.genre].filter(Boolean).join(' | '), page: r.page, depth: r.depth });
                continue;
              }
              if (r.chapter) y += lineH * 0.5;
              const ix = textX + r.indent;
              // a part or manuscript row (plain) is never the last row of a page: its first row comes with it
              if (y + lineH * (r.plain ? 2 : 1) > maxContentY) y = startNewTitlePage();
              doc.setFont(fontFamily, r.chapter ? 'bold' : 'normal');
              doc.setFontSize(pdfFontSize);
              doc.setTextColor(0, 0, 0);
              const pageStr = String(r.page);
              const pageX = pageWidth - pdfMarginRight - doc.getTextWidth(pageStr);
              // the framed running number in front of a document row
              const numW = rows.some((q) => q.num) ? numBoxW + 8 : 0;
              if (r.num) {
                const fsN = pdfFontSize - 1;
                doc.setFontSize(fsN);
                const nw = doc.getTextWidth(r.num);
                doc.setLineWidth(0.4);
                doc.setDrawColor(0, 0, 0);
                doc.rect(ix, y - fsN * 0.8 - 1.5, numBoxW, fsN + 3);
                doc.text(r.num, ix + numBoxW / 2 - nw / 2, y);
                doc.setFontSize(pdfFontSize);
              }
              const x1 = r.plain ? ix : ix + numW + idW;
              if (!r.plain) doc.text(r.id, ix + numW, y);
              // incipit, then the genre in light grey; both cut to what fits before the leader
              let incipit = r.incipit;
              const room = pageX - x1 - 24;
              while (incipit.length > 1 && doc.getTextWidth(incipit) > room) incipit = incipit.slice(0, -1);
              if (incipit !== r.incipit) incipit = incipit.trimEnd() + '…';
              doc.text(incipit, x1, y);
              if (r.chapter) doc.setFont(fontFamily, 'normal');
              let endX = x1 + doc.getTextWidth(incipit);
              if (r.genre && room - doc.getTextWidth(incipit) > 40) {
                let g = r.genre;
                const gRoom = room - doc.getTextWidth(incipit) - 12;
                doc.setFontSize(pdfFontSize - 1);
                while (g.length > 1 && doc.getTextWidth(g) > gRoom) g = g.slice(0, -1);
                doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
                doc.text(g, endX + 10, y);
                endX += 10 + doc.getTextWidth(g);
                doc.setFontSize(pdfFontSize);
              }
              doc.setTextColor(0, 0, 0);
              doc.text(pageStr, pageX, y);
              const dotStep = doc.getTextWidth(' .');
              const n = Math.floor((pageX - 5 - (endX + 6)) / dotStep);
              if (n > 1) {
                doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
                doc.text(' .'.repeat(n), pageX - 5 - n * dotStep, y);
                doc.setTextColor(0, 0, 0);
              }
              stats.outline.push({ label: [r.id, r.incipit, r.genre].filter(Boolean).join(' | '), page: r.page, depth: r.depth });
              y += lineH;
            }
          }
        }

        // References from each manuscript's start in the edition to its other parts
        for (const ref of crossRefs) {
          const firstOf = (list: { job: number; page: number }[]) => list.find((x) => chapterKeyOf(jobs[x.job]) === chapterKeyOf(jobs[ref.ji]))?.page;
          const parts: string[] = [];
          const descPage = firstOf(descriptionOutline);
          const notPage = firstOf(notationOutline);
          const edPage = firstOf(docEntries.map((e) => ({ job: e.job, page: e.page })));
          const appPage = firstOf(apparatusOutline.filter((o) => o.depth === 1 || !chapterRows));
          if (descPage) parts.push('Source Description: p. ' + descPage);
          if (notPage) parts.push('Notation Documentation: p. ' + notPage);
          if (edPage) parts.push('Edition: p. ' + edPage);
          if (appPage) parts.push('Critical Apparatus: p. ' + appPage);
          if (parts.length < 2) continue;
          doc.setPage(ref.page + pageShift());
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(60, 60, 60);
          doc.text(parts.join(' | '), textX, ref.y);
          doc.setTextColor(0, 0, 0);
        }

        // Page furniture. 'print' (default) follows the printed edition: a running head on
        // EVERY page — source line left, page number right, a thin rule underneath — and no
        // footer. 'classic' keeps the old footer ("Page n of m") and headline from page 2.
        const totalPages = doc.getNumberOfPages();
        const printStyle = (s.pdfPageStyle ?? PRINT_PDF_DEFAULTS.pdfPageStyle) !== 'classic';
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          doc.setPage(pageNum);
          doc.setTextColor(0, 0, 0);
          if (pageNum <= titlePageCount) continue;          // title page(s): no running head, no number
          if (partPages.has(pageNum - pageShift())) continue;             // part pages: only the name and the rule
          const editionNo = pageNum - titlePageCount;       // position inside the edition
          const shownPage = editionNo + numberOffset;
          const shownTotal = totalPages - titlePageCount + numberOffset;

          if (printStyle) {
            const headY = Math.max(14, pdfMarginTop - 22);
            doc.setFont(fontFamily, "normal");
            doc.setFontSize(pdfHeadlineFontSize);
            const maxHeadW = printWidth - 30;
            let headText = headOf(ownerOf(pageNum));
            while (headText.length > 1 && doc.getTextWidth(headText) > maxHeadW) headText = headText.slice(0, -1);
            if (headText) doc.text(headText, pdfMarginLeft, headY);
            if (pdfShowPageNumbers) {
              doc.setFontSize(pdfPageNumberFontSize);
              const num = String(shownPage);
              doc.text(num, pageWidth - pdfMarginRight - doc.getTextWidth(num), headY);
            }
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.4);
            doc.line(pdfMarginLeft, headY + 5.5, pageWidth - pdfMarginRight, headY + 5.5);
            continue;
          }

          // Classic page numbers
          if (pdfShowPageNumbers) {
            doc.setFontSize(pdfPageNumberFontSize);
            doc.setFont(fontFamily, "normal");
            doc.setTextColor(120, 120, 120);
            const pageNumText = `Page ${shownPage} of ${shownTotal}`;
            const pageNumWidth = doc.getTextWidth(pageNumText);
            const textY = pageHeight - (pdfMarginBottom / 2);
            doc.text(pageNumText, pdfMarginLeft + printWidth / 2 - pageNumWidth / 2, textY);
          }

          // Classic running headline from the edition's second page
          if (editionNo > 1) {
            const headlineText = buildHeadline(jobs[ownerOf(pageNum)].document, pdfHeadlineMetadataFields, opts.settings);
            if (headlineText) {
              const headlineFontSize = pdfHeadlineFontSize;
              doc.setFontSize(pdfHeadlineFontSize);
              doc.setFont(fontFamily, "italic");
              doc.setTextColor(80, 80, 80);
              
              const splitHeadline = doc.splitTextToSize(headlineText, printWidth);
              let headlineY = pdfMarginTop / 2;
              
              for (const line of splitHeadline) {
                const lineX = pdfMarginLeft + printWidth / 2 - doc.getTextWidth(line) / 2;
                doc.text(line, lineX, headlineY);
                headlineY += headlineFontSize * 1.2;
              }
              
              const lineUnderY = headlineY - (headlineFontSize * 1.2) + 6;
              doc.setLineWidth(0.5);
              doc.setDrawColor(200, 200, 200);
              doc.line(pdfMarginLeft, lineUnderY, pageWidth - pdfMarginRight, lineUnderY);
            }
          }
        }


        // PDF bookmarks mirror the hierarchy of the contents (chapter > document)
        const outlineApi = (doc as any).outline;
        if (bookmarks && outlineApi?.add && stats.outline.length) {
          const parents: any[] = [null];
          for (const o of stats.outline) {
            const depth = Math.min(Math.max(o.depth, 0), parents.length - 1);
            const node = outlineApi.add(parents[depth], o.label || '–', { pageNumber: Math.max(1, o.page - numberOffset + titlePageCount) });
            parents[depth + 1] = node;
            parents.length = depth + 2;
          }
        }
        stats.pages = doc.getNumberOfPages();
        stats.frontPages = titlePageCount;
        const tSave = performance.now();
        if (opts.output === 'blob') stats.blob = doc.output('blob');
        else doc.save(opts.fileName || (multi ? 'Documents.pdf' : 'Document_' + (jobs[0].document.dokumenten_id || 'Export') + '.pdf'));
        stats.timings['save'] = performance.now() - tSave;
        stats.timings['total'] = performance.now() - t0;
        console.debug('[pdf-export]', JSON.stringify({ documents: jobs.length, pages: stats.pages, ms: Object.fromEntries(Object.entries(stats.timings).map(([k, v]) => [k, Math.round(v)])) }));
        return stats;
    } finally {
      // nothing to restore: the export reads the model and never touches the page
    }
  }
}
