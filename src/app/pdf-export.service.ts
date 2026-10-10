import { Injectable, NgZone } from '@angular/core';
import { jsPDF } from 'jspdf';
import * as VM from './types/model';
import { Document, ProjectSettings, Source } from './api.service';
import { embeddedFamily, registerEmbeddedFont } from './pdf-font';
import { PRINT_PDF_DEFAULTS, pdfPageFormat } from './pdf-defaults';
import { layoutPdfLine } from './pdf-layout';
import { sanitizeNotationColor } from './notation-color';
import { ClefDisplayMode, sanitizeClefDisplayMode, shouldShowClef } from './clef-policy';
import { commentLemma, commentStartIndex, commentType } from './comment-lemma';
import { resolvePrintOptions } from './print/print-options';
import { chapterize } from './print/chapters';
import { formatFolioLabel, sanitizeFolioPrefixMode, usesFolioPrefix } from './folio-label';
import { genreOf, headlineText as buildHeadline, inlineMetadataItems, metadataFieldValue } from './document-metadata';
import { getCategoryDetails } from './comment/comment-categories';
import { documentBlocks, printedParts } from './print/document-blocks';
import { CapsMode, TextStyle, capsModeFor, smallCapsRuns, styledLyric } from './print/text-style';
import { SyllableGeometry, syllableGeometry } from './print/notation-geometry';
import { drawGClef, drawStaff, drawSyllableNotation, RGB } from './print/notation-draw';
import { Box, TreeKit, layoutCommentTree } from './print/comment-tree-layout';
import { FontStyle, TextKit, breakLines, drawLines, linesWidth } from './print/rich-text';
import { MdBlock, MdInline, parseMarkdown, safeHref } from './print/markdown';
import { MdLine, layoutInlines, lineWidth } from './print/markdown-layout';
import { LoadedImage, loadImage } from './print/image-loader';
import { sourceDescription } from './source-description';

/** Internal-unit width of an injected clef (same as NotesComponent.CLEF_WIDTH). */
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
  /** Several documents: the contents table on the title page (needs a title page). Default: yes. */
  contents?: boolean;
  /** Several documents: every document starts on a new page. Default: no — they run on in one flow. */
  newPagePerDocument?: boolean;
  /** The framed running number in the left margin (default: shown). */
  boxLabel?: PdfBoxLabel;
  /** Override of the configured page format ('a4', 'cm' = 21 x 27 cm, ...). */
  pageFormat?: string;
  /** Title of a multi-document print (title page). */
  title?: string;
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
  /** Lines of the contents table: "ID | incipit | genre", page. */
  outline: { label: string; page: number; depth: number }[];
  /** Where the time went (ms): render, measure, svg (drawing the notes), apparatus, save, total. */
  timings: { [phase: string]: number };
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  lastStats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, descriptionPage: 0, outline: [], timings: {} };

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
    /** Turns the typed folio label into the printed one. */
    formatFolio: (label: string) => string;
  }): PdfMeasuredPart[] {
    const { doc, fontFamily, pdfFontSize, SCALE } = c;
    const adiastematic = zeile.notation === 'adiastematic';
    const children = zeile.children || [];
    const out: PdfMeasuredPart[] = [];
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
      const finalSecWidth = Math.max(svgWidth, lyricShift + textWidth + c.extraSyllableSpacing - 12 * SCALE);

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

  private async exportInner(jobsIn: PdfDocJob[], opts: PdfExportOptions): Promise<PdfExportStats> {
    if (!jobsIn.length) throw new Error('Nothing to print');
    // Documents of one manuscript belong together: each manuscript is a chapter (stable by first appearance).
    const chapterKeyOf = (j: PdfDocJob) => (j.source as any)?.id ?? (j.sigle || (j.source as any)?.quellensigle || '');
    const { items: jobs, chapterNo, chapterFirst, runningNo, count: chapterCount } = chapterize(jobsIn, chapterKeyOf);
    const stats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, descriptionPage: 0, outline: [], timings: {} };
    const t0 = performance.now();
    /** Adds the time `fn` takes to the phase `name`. */
    const timedSync = <T>(name: string, fn: () => T): T => {
      const a = performance.now();
      try { return fn(); } finally { stats.timings[name] = (stats.timings[name] || 0) + (performance.now() - a); }
    };
    this.lastStats = stats;
    const multi = jobs.length > 1;

    try {
        const s: any = { ...(opts.settings || {}), ...(opts.pageFormat ? { pdfFormat: opts.pageFormat, pdfOrientation: 'portrait' } : {}) };
        const doc = new jsPDF({ unit: 'pt', format: pdfPageFormat(s.pdfFormat), orientation: (s.pdfOrientation || 'portrait'), compress: true });
        const fontSetting: string = s.pdfFontFamily || PRINT_PDF_DEFAULTS.pdfFontFamily;
        const fontFamily = embeddedFamily(fontSetting) || fontSetting;
        if (embeddedFamily(fontFamily)) {
          await registerEmbeddedFont(doc, fontFamily);
        }
        const {
          pdfMarginLeft, pdfMarginRight, pdfMarginTop, pdfMarginBottom, SCALE, pdfStaffSpacing, pdfBracketGap, pdfSyllableTextOffset,
          extraSyllableSpacing, pdfContinuationIndent, pdfFontSize, pdfSignaturSpace, pdfVerticalSpace, widowSlack, hideBareStaff,
          compactTextless, statusTextStyles, titleFontSize, pdfTitleVerticalSpace, headerSource, metaFontSize, pdfMetadataVerticalSpace,
          pdfParatextFontSize, pdfParatextSpacing, pdfCommentStaffScale, pdfCommentFontSize, pdfCommentBlockGap, lemmaColumnMax,
          chapterHeadings, chapterNewPage, contentsApparatus, pdfShowPageNumbers, pdfPageNumberFontSize, pdfHeadlineFontSize,
          pdfHeadlineMetadataFields, bookmarks,
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
        let titlePageCount = 0;
        if (useTitlePage) {
          titlePageCount = 1;
          doc.addPage();
          cursorY = pdfMarginTop;
        }
        const editionPage = () => doc.getNumberOfPages() - titlePageCount;
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
        const boxTexts = runningNo.map(String);
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
        /** Chapter heading: the manuscript, large, over a rule — numbered when there are several. */
        const drawChapterHeading = (ji: number): void => {
          const fsC = titleFontSize + 3;
          const text = (chapterCount > 1 ? chapterNo[ji] + '. ' : '') + headOf(ji);
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(fsC);
          doc.setTextColor(0, 0, 0);
          const lines: string[] = doc.splitTextToSize(text, printWidth);
          lines.forEach((l, li) => doc.text(l, pdfMarginLeft, cursorY + fsC + li * fsC * 1.2));
          const yRule = cursorY + fsC + (lines.length - 1) * fsC * 1.2 + 6;
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(0.6);
          doc.line(pdfMarginLeft, yRule, pageWidth - pdfMarginRight, yRule);
          cursorY = yRule + 22;
        };
        const ownerOf = (page: number): number => {
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


        // ── Layout of one document (rendered in the host) ───────────────────────────────────
        const layoutDocument = async (job: PdfDocJob, ji: number) => {
          const headerText = titleOf(job);
          const titleLineH = titleFontSize * 1.15;
          // One document with a title page: the title stands there. Otherwise every document
          // gets its own heading (title, framed edition number, metadata line).
          if (!(useTitlePage && !multi)) {
            doc.setFontSize(titleFontSize);
            doc.setFont(fontFamily, "normal");
            if (multi) {
              // Several documents run on in one flow. A document begins with a hairline and one
              // heading line — framed edition number, ID in bold, incipit, genre in grey — instead
              // of a page of its own.
              const fsH = pdfFontSize + 1;
              const idText = job.document.dokumenten_id || '';
              const incipitText = job.document.textinitium || '';
              const genreText = genreOf(job.document);
              doc.setFontSize(fsH);
              doc.setFont(fontFamily, 'bold');
              const idW = idText ? doc.getTextWidth(idText) + 10 : 0;
              doc.setFont(fontFamily, 'normal');
              const incLines: string[] = doc.splitTextToSize(incipitText, Math.max(60, pageWidth - pdfMarginRight - textX - idW));
              const lineHM = fsH * 1.25;
              if (cursorY > pdfMarginTop + 1) {
                doc.setDrawColor(PDF_KEY_GREY + 40, PDF_KEY_GREY + 40, PDF_KEY_GREY + 40);
                doc.setLineWidth(0.4);
                doc.line(textX, cursorY - fsH - 3, pageWidth - pdfMarginRight, cursorY - fsH - 3);
              }
              drawBox(boxTextOf(ji), cursorY, fsH);
              doc.setFontSize(fsH);
              doc.setTextColor(0, 0, 0);
              if (idText) { doc.setFont(fontFamily, 'bold'); doc.text(idText, textX, cursorY); }
              doc.setFont(fontFamily, 'normal');
              incLines.forEach((l, li) => doc.text(l, textX + idW, cursorY + li * lineHM));
              const lastLine = incLines[incLines.length - 1] || '';
              if (genreText) {
                const lastW = doc.getTextWidth(lastLine);
                doc.setFontSize(pdfFontSize - 1);
                doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
                const gx = textX + idW + lastW + 10;
                doc.text(genreText, Math.min(gx, pageWidth - pdfMarginRight - doc.getTextWidth(genreText)), cursorY + (incLines.length - 1) * lineHM);
                doc.setTextColor(0, 0, 0);
              }
              cursorY += incLines.length * lineHM + (opts.includeMetadata ? 3 : 7);
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
            if (opts.includeMetadata) {
              doc.setFontSize(metaFontSize);
          
              // several documents: ID, incipit, genre and edition number are in the heading already
              const items = inlineMetadataItems(job.document, opts.settings)
                .filter((it) => !multi || !['ID', 'Initium', 'Genre', 'Edition'].includes(it.label));
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
                drawWords(items[k].label + ": ", 'normal', true);
                drawWords(items[k].val, 'normal');
                if (k < items.length - 1) drawWords("   •   ", 'normal');
              }

              cursorY = curY + (multi ? 9 : pdfMetadataVerticalSpace);
              checkPageOverflow(0);
            }

          }
            // DOM Traversal for Structural Layout
            doc.setFontSize(12);
        
            // Comment spans are marked like in the printed edition: only the corners of a
            // horizontal bracket, in grey, around the lyric they refer to (the apparatus
            // cites that text instead of a number).
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
            const documentComments = job.cont.comments || [];
        
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
                if (!wasLastElementParatext) {
                  checkPageOverflow(pdfVerticalSpace);
                  cursorY += pdfVerticalSpace;
                }
                wasLastElementParatext = false;
                continue;
              }
              const zeile = block.kind === 'zeile' ? block.zeile : null;
              const parts = zeile ? printedParts(zeile) : [];
          
              if (zeile && parts.length > 0) {
                const afterParatext = paratextPending;
                paratextPending = false;
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
                  doc, fontFamily, pdfFontSize, SCALE, extraSyllableSpacing, textOffset: pdfSyllableTextOffset, clefMode, firstSyllableUuid, textStyle: statusTextStyles[block.kind === 'zeile' ? block.status : ''],
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
                // Like the printed edition: the first system follows its rubric closely.
                if (afterParatext && lastParatextPage === doc.getNumberOfPages()) {
                  cursorY = Math.min(cursorY, lastParatextBaselineY + PDF_PARATEXT_BELOW);
                  lineStartY = cursorY;
                }
                // A system never starts so low that its lyrics would run into the bottom margin.
                const systemNeed = (si: number) => (sysHeights[si] || 30) + pdfSyllableTextOffset + pdfFontSize * 0.5;
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
                      doc.setFontSize(pdfFontSize);
                      doc.setFont(fontFamily, "normal");
                      const sigText = currentSignatures.join(" ");
                      const sigWidth = doc.getTextWidth(sigText);
                      const sigX = pdfMarginLeft + sigWidth + 6 <= musicStartX ? pdfMarginLeft : musicStartX - sigWidth - 6;
                      // Print edition: the signature's baseline sits ~2.9 pt above the bottom staff line.
                      doc.text(sigText, sigX, cursorY - trim + (80 - sysRawTops[pl.system]) * SCALE - 2.9);
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
                     const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + 3) : pdfBracketGap);
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
                     checkPageOverflow(systemNeed(pl.system));
                 
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
                                  const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + 3) : pdfBracketGap);
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
                const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + 3) : pdfBracketGap);
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
            
              } else if (block.kind === 'paratext') {
                // Rubric / paratext
                const txt = block.text;
            
                if (txt) {
                  doc.setFontSize(pdfParatextFontSize);
                  doc.setFont(fontFamily, "normal");
              
                  const splitText = doc.splitTextToSize(txt, Math.max(60, pageWidth - pdfMarginRight - textX));
                  // Keep with next: a rubric (or a run of rubrics) must not be left alone at the
                  // bottom of a page — the first system that follows has to fit with it.
                  let followNeed = 0;
                  for (let k = i + 1; k < Math.min(blocks.length, i + 8); k++) {
                    const nb = blocks[k];
                    if (nb.kind === 'zeile') { if (printedParts(nb.zeile).length) { followNeed += 55; break; } continue; }
                    if (nb.kind === 'formteil') continue;
                    followNeed += pdfParatextFontSize * 1.4 + pdfParatextSpacing; // another rubric in between
                  }
                  const ownNeed = splitText.length * pdfParatextFontSize * 1.4 + pdfParatextSpacing;
                  if (cursorY + ownNeed + followNeed > maxContentY && cursorY > pdfMarginTop + 1 && ownNeed + followNeed < maxContentY - pdfMarginTop) {
                    doc.addPage();
                    cursorY = pdfMarginTop;
                  }
                  checkPageOverflow(pdfParatextFontSize * 2);
                  doc.text(splitText, textX, cursorY);
                  lastParatextBaselineY = cursorY + (splitText.length - 1) * pdfParatextFontSize * doc.getLineHeightFactor();
                  lastParatextPage = doc.getNumberOfPages();
                  paratextPending = true;
                  cursorY += (splitText.length * (pdfParatextFontSize * 1.4)) + pdfParatextSpacing;
                  checkPageOverflow(0);
                  wasLastElementParatext = true;
                }
              }
            }

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
          const hasComments = (job.cont.comments && job.cont.comments.length > 0) || job.cont.globalComment;
          if (!hasComments) return;
            if (!apparatusStarted) {
                // the apparatus starts on a page of its own, after all editions
                doc.addPage();
                cursorY = pdfMarginTop;
                apparatusPage = editionPage();
                apparatusStarted = true;
                cursorY = drawHeading('Critical Apparatus', textX, cursorY + 3, textColumnW, 10) + 2;
            } else {
                checkPageOverflow(60);
            }
            if (multi) {
                // Hierarchy like the printed apparatus: the manuscript (chapter heading), below it
                // each document — framed running number, ID, incipit, genre — and its entries.
                if (chapterFirst[ji] && chapterHeadings) {
                    checkPageOverflow(80);
                    cursorY += 10;
                    const fsC = 11.5;
                    const chapterText = (chapterCount > 1 ? chapterNo[ji] + '. ' : '') + headOf(ji);
                    doc.setFont(fontFamily, 'normal');
                    doc.setFontSize(fsC);
                    doc.setTextColor(0, 0, 0);
                    const cl: string[] = doc.splitTextToSize(chapterText, textColumnW);
                    cl.forEach((l, li) => doc.text(l, textX, cursorY + fsC + li * fsC * 1.2));
                    const yr = cursorY + fsC + (cl.length - 1) * fsC * 1.2 + 4.5;
                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.5);
                    doc.line(textX, yr, textX + textColumnW, yr);
                    cursorY = yr + 10;
                    if (chapterCount > 1) apparatusOutline.push({ label: chapterText, depth: 1, job: ji, page: editionPage() });
                }
                checkPageOverflow(46);
                cursorY += 6;
                const fsD = pdfCommentFontSize + 1;
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
                apparatusOutline.push({ label: [idText, incipit].filter(Boolean).join(' '), depth: chapterCount > 1 ? 2 : 1, job: ji, page: editionPage() });
            }
            apparatusSpans.push({ job: ji, from: doc.getNumberOfPages() });

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
                doc.setDrawColor(PDF_CORNER_GREY, PDF_CORNER_GREY, PDF_CORNER_GREY);
                doc.setLineWidth(PDF_CORNER_WIDTH);
                doc.line(x, y, x + 3, y);
                doc.line(x + 3, y, x + 3, y + h);
                doc.line(x + 3, y + h, x, y + h);
              },
              notes: (zeile, context, maxW) => inlineZeileBox(zeile, context, maxW),
            };
            const placeBox = (box: Box, indent: number) => {
              if (cursorY + box.h > maxContentY && cursorY > pdfMarginTop + 1) { doc.addPage(); cursorY = pdfMarginTop; }
              box.draw(textX + indent, cursorY, box.h);
              cursorY += box.h;
            };

            // Plain-text comments are typeset directly: lemma, "]", then the comment with the
            // usual markup (plain = italic, ((quoted)) = roman, [[SIGLUM]] = bold small, {{boxed}}).
            const drawTextEntry = (c: VM.Comment) => {
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
                if (cursorY + height > maxContentY && cursorY > pdfMarginTop + 1) { doc.addPage(); cursorY = pdfMarginTop; }
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
            };


            // An entry whose body is a comment tree or a set of lines: like the printed apparatus the
            // lemma stands in a narrow left column, level with the staff, and the body to its right.
            const LEMMA_COL_MAX = lemmaColumnMax;
            const lemmaOf = (c: VM.Comment) => { const l = commentLemma(jobParts, c); return l ? l + ']' : ''; };
            const lemmaColW = (c: VM.Comment): number => {
              const t = lemmaOf(c);
              if (!t) return 0;
              const w = textKit.width(t, 'normal', pdfCommentFontSize) + 8;
              return w <= LEMMA_COL_MAX ? Math.max(w, 26) : 0;   // longer: above the body
            };
            const drawStructuredEntry = (c: VM.Comment, makeBody: (maxW: number) => Box) => {
              const colW = lemmaColW(c);
              const lemma = lemmaOf(c);
              const body = makeBody(textColumnW - colW - 4);
              const above = !!lemma && colW === 0;
              // a long lemma stands above the body and wraps like text
              const lemmaLines = above ? breakLines([{ w: lemma, style: 'normal', size: pdfCommentFontSize }], textColumnW, textKit) : [];
              const aboveH = above ? lemmaLines.length * pdfCommentFontSize * 1.38 : 0;
              if (cursorY + body.h + aboveH > maxContentY && cursorY > pdfMarginTop + 1) { doc.addPage(); cursorY = pdfMarginTop; }
              if (lemma) {
                const mid = body.anchor ?? pdfCommentFontSize * 0.7;
                if (above) drawLines(lemmaLines, textX, cursorY + pdfCommentFontSize, pdfCommentFontSize * 1.38, textKit);
                else textKit.draw(lemma, textX, cursorY + mid + pdfCommentFontSize * 0.33, 'normal', pdfCommentFontSize);
              }
              body.draw(textX + colW + (above ? 8 : 0), cursorY + aboveH, body.h);
              cursorY += aboveH + body.h + pdfCommentBlockGap - 1;
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
              checkPageOverflow(30);
              doc.setFont(fontFamily, 'normal');
              doc.setFontSize(pdfCommentFontSize - 0.5);
              doc.setTextColor(PDF_KEY_GREY - 40, PDF_KEY_GREY - 40, PDF_KEY_GREY - 40);
              doc.text('GLOBAL COMMENT', textX, cursorY + pdfCommentFontSize, { charSpace: 0.7 });
              doc.setTextColor(0, 0, 0);
              cursorY += pdfCommentFontSize * 1.6;
              placeBox(layoutCommentTree(job.cont.globalComment, treeKit, textColumnW - 8), 8);
              cursorY += pdfCommentBlockGap + 2;
            }
            const ordered = (job.cont.comments || [])
              .map((c, i) => ({ c, i, pos: commentStartIndex(jobParts, c) }))
              .sort((x, y) => (x.pos - y.pos) || (x.i - y.i));
            for (const { c } of ordered) {
              const type = commentType(c);
              if (type === 'tree' && c.tree) drawStructuredEntry(c, (w) => layoutCommentTree(c.tree!, treeKit, w));
              else if (type === 'lines' && c.lines) drawStructuredEntry(c, (w) => linesBox(c, w));
              else drawTextEntry(c);
            }
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
          cursorY = drawHeading(descriptionTitle, textX, cursorY + 3, textColumnW, 10) + 2;
          withText.forEach(({ job: ji, blocks }, k) => {
            if (multi) {
              // the manuscript as a chapter heading, like in the apparatus
              checkPageOverflow(80);
              if (k > 0) cursorY += 14;
              cursorY += 10;
              const fsC = 11.5;
              const chapterText = (chapterCount > 1 ? chapterNo[ji] + '. ' : '') + headOf(ji);
              doc.setFont(fontFamily, 'normal');
              doc.setFontSize(fsC);
              doc.setTextColor(0, 0, 0);
              const cl: string[] = doc.splitTextToSize(chapterText, textColumnW);
              cl.forEach((l, li) => doc.text(l, textX, cursorY + fsC + li * fsC * 1.2));
              const yr = cursorY + fsC + (cl.length - 1) * fsC * 1.2 + 4.5;
              doc.setDrawColor(0, 0, 0);
              doc.setLineWidth(0.5);
              doc.line(textX, yr, textX + textColumnW, yr);
              cursorY = yr + 12;
              descriptionOutline.push({ label: chapterText, job: ji, page: editionPage() });
            } else checkPageOverflow(60);
            apparatusSpans.push({ job: ji, from: doc.getNumberOfPages() });   // the running head names this manuscript
            mdQuoteBars = [];
            drawMdBlocks(blocks, textX, textColumnW, pdfFontSize - 1);
          });
        };

        // ── Render, lay out, then the apparatus ─────────────────────────────────────────────
        for (let ji = 0; ji < jobs.length; ji++) {
          opts.onProgress?.('Rendering ' + (jobs[ji].document.dokumenten_id || jobs[ji].document.textinitium || ''), ji, jobs.length);
          if (multi && chapterFirst[ji] && chapterNewPage) {
            // a manuscript starts a new page with its chapter heading
            if (ji > 0) { doc.addPage(); cursorY = pdfMarginTop; }
          } else if (ji > 0) {
            if (opts.newPagePerDocument) { doc.addPage(); cursorY = pdfMarginTop; }
            else {
              // the next document follows with a gap; heading, metadata and the first system
              // must fit with it, otherwise it starts the next page
              cursorY += pdfVerticalSpace * 2 + 6;
              if (cursorY + 120 > maxContentY) { doc.addPage(); cursorY = pdfMarginTop; }
            }
          }
          docEntries.push({ job: ji, page: editionPage() });
          docStart.push(doc.getNumberOfPages());
          if (multi && chapterFirst[ji] && chapterHeadings) drawChapterHeading(ji);
          await layoutDocument(jobs[ji], ji);
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
        stats.documents = docEntries.map((e) => ({ id: jobs[e.job].document.dokumenten_id || '', page: e.page }));
        stats.apparatusPage = apparatusStarted ? apparatusPage : 0;
        stats.descriptionPage = descriptionStarted ? descriptionPage : 0;

        // ── Title page: title, source and — for one document — its metadata table, for several
        //    documents the contents table (ID, incipit, genre, page) ─────────────────────────────
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
          doc.setPage(1);
          let y = Math.max(pdfMarginTop + 30, pageHeight * 0.17);
          doc.setTextColor(0, 0, 0);
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(PDF_TITLE_PAGE_SIZE);
          const mainTitle = multi ? (opts.title || jobs.length + ' documents') : titleOf(jobs[0]);
          for (const line of doc.splitTextToSize(mainTitle, printWidth - 60)) {
            doc.text(line, cx, y, { align: 'center' });
            y += PDF_TITLE_PAGE_SIZE * 1.22;
          }
          const sameSource = jobs.every((j) => (j.source?.id ?? '') === (jobs[0].source?.id ?? ''));
          const subtitle = multi ? (sameSource ? headOf(0) : '') : headOf(0);
          if (subtitle && subtitle !== mainTitle) {
            y += 4;
            doc.setFontSize(pdfFontSize + 1);
            doc.setTextColor(PDF_KEY_GREY - 30, PDF_KEY_GREY - 30, PDF_KEY_GREY - 30);
            doc.text(subtitle, cx, y, { align: 'center' });
            y += 10;
          }
          if (multi) {
            doc.setFontSize(pdfFontSize - 0.5);
            doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
            doc.text(jobs.length + ' documents', cx, y + 4, { align: 'center' });
            y += 12;
          }
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(0.5);
          doc.line(cx - 22, y, cx + 22, y);
          y += 34;

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
            const docIndent = chapterCount > 1 ? 24 : 12;
            const docDepth = chapterCount > 1 ? 2 : 1;
            rows.push({ id: '', incipit: 'Edition', genre: '', page: docEntries[0]?.page ?? 1, plain: true, chapter: true, indent: 0, depth: 0 });
            docEntries.forEach((e) => {
              const j = jobs[e.job];
              if (chapterCount > 1 && chapterFirst[e.job]) rows.push({ id: '', incipit: chapterNo[e.job] + '. ' + headOf(e.job), genre: '', page: e.page, plain: true, indent: 12, depth: 1 });
              rows.push({ id: j.document.dokumenten_id || '', incipit: j.document.textinitium || '', genre: genreOf(j.document), page: e.page, indent: docIndent, depth: docDepth, num: boxTextOf(e.job) });
            });
            if (apparatusStarted) {
              rows.push({ id: '', incipit: 'Critical Apparatus', genre: '', page: apparatusPage, plain: true, chapter: true, indent: 0, depth: 0 });
              for (const ao of apparatusOutline) {
                if (ao.depth === 1 && chapterCount > 1) rows.push({ id: '', incipit: ao.label, genre: '', page: ao.page, plain: true, indent: 12, depth: 1, bookmarkOnly: contentsApparatus === 'none' });
                else {
                  const j = jobs[ao.job];
                  rows.push({ id: j.document.dokumenten_id || '', incipit: j.document.textinitium || '', genre: genreOf(j.document), page: ao.page, indent: docIndent, depth: docDepth, num: boxTextOf(ao.job), bookmarkOnly: contentsApparatus !== 'documents' });
                }
              }
            }
            if (descriptionStarted) {
              rows.push({ id: '', incipit: descriptionTitle, genre: '', page: descriptionPage, plain: true, chapter: true, indent: 0, depth: 0 });
              if (chapterCount > 1) for (const d of descriptionOutline) rows.push({ id: '', incipit: d.label, genre: '', page: d.page, plain: true, indent: 12, depth: 1 });
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
              if (y + lineH > maxContentY) y = startNewTitlePage();
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

        // Page furniture. 'print' (default) follows the printed edition: a running head on
        // EVERY page — source line left, page number right, a thin rule underneath — and no
        // footer. 'classic' keeps the old footer ("Page n of m") and headline from page 2.
        const totalPages = doc.getNumberOfPages();
        const printStyle = (s.pdfPageStyle ?? PRINT_PDF_DEFAULTS.pdfPageStyle) !== 'classic';
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          doc.setPage(pageNum);
          doc.setTextColor(0, 0, 0);
          if (pageNum <= titlePageCount) continue;          // title page(s): no running head, no number
          const shownPage = pageNum - titlePageCount;       // the edition is numbered from 1
          const shownTotal = totalPages - titlePageCount;

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
          if (shownPage > 1) {
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
            const node = outlineApi.add(parents[depth], o.label || '–', { pageNumber: Math.max(1, o.page + titlePageCount) });
            parents[depth + 1] = node;
            parents.length = depth + 2;
          }
        }
        stats.pages = doc.getNumberOfPages();
        const tSave = performance.now();
        doc.save(opts.fileName || (multi ? 'Documents.pdf' : 'Document_' + (jobs[0].document.dokumenten_id || 'Export') + '.pdf'));
        stats.timings['save'] = performance.now() - tSave;
        stats.timings['total'] = performance.now() - t0;
        console.debug('[pdf-export]', JSON.stringify({ documents: jobs.length, pages: stats.pages, ms: Object.fromEntries(Object.entries(stats.timings).map(([k, v]) => [k, Math.round(v)])) }));
        return stats;
    } finally {
      // nothing to restore: the export reads the model and never touches the page
    }
  }
}
