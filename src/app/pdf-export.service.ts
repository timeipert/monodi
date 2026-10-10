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
import { genreOf, headlineText as buildHeadline, inlineMetadataItems, metadataFieldValue } from './document-metadata';
import { getCategoryDetails } from './comment/comment-categories';
import { documentBlocks, printedParts } from './print/document-blocks';
import { SyllableGeometry, syllableGeometry } from './print/notation-geometry';
import { drawGClef, drawStaff, drawSyllableNotation, RGB } from './print/notation-draw';
import { Box, TreeKit, layoutCommentTree } from './print/comment-tree-layout';
import { TextKit, breakLines, drawLines, linesWidth } from './print/rich-text';

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
  /** Lyric set in small capitals (all-caps syllables, as in the printed edition). */
  smallCaps?: 'all' | 'first';
}

/** One document to print: its metadata, transcription and (for the running head) its source. */
export interface PdfDocJob {
  document: Document;
  cont: VM.RootContainer;
  source: Source | null;
  sigle: string;
}

/** Content of the framed number before each document: siglum + running number per manuscript,
 *  siglum + first word of the incipit, genre + siglum, or nothing. */
export type PdfBoxLabel = 'enumeration' | 'incipit' | 'genre' | 'none';

export interface PdfExportOptions {
  settings: ProjectSettings | null;
  /** A title page (always present for several documents). */
  titlePage: boolean;
  /** Metadata: a table on the title page (one document) / a line under each document's title. */
  includeMetadata: boolean;
  /** The collected critical apparatus. */
  apparatus: boolean;
  /** Several documents: the contents table on the title page (needs a title page). Default: yes. */
  contents?: boolean;
  /** Several documents: every document starts on a new page. Default: no — they run on in one flow. */
  newPagePerDocument?: boolean;
  /** What the framed number in the left margin shows (default: manuscript siglum + running number). */
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
  /** Lines of the contents table: "ID | incipit | genre", page. */
  outline: { label: string; page: number }[];
  /** Where the time went (ms): render, measure, svg (drawing the notes), apparatus, save, total. */
  timings: { [phase: string]: number };
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  lastStats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, outline: [], timings: {} };

  constructor(private zone: NgZone) {}


  /**
   * Measures the printed parts of a line straight from the model (no DOM): syllable geometry
   * from the drawables, lyric widths in the PDF font, marker widths. The vertical numbers keep
   * the conventions of the edition view (raw top 10, 65 + 10 + bottom padding per voice).
   */
  private measureLineParts(zeile: VM.ZeileContainer, c: {
    doc: jsPDF; fontFamily: string; pdfFontSize: number; SCALE: number; extraSyllableSpacing: number;
    textOffset: number; clefMode: ClefDisplayMode; firstSyllableUuid: string | null;
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
          folioLabel = (lp.text || '').trim() || undefined;
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
      const svgWidth = geom.widthUnits * SCALE;

      let txt = (lp.text || '').trim();
      let textWidth = 0;
      if (txt && txt !== 'X' && txt !== '...' && txt !== '<...>') {
        txt = txt.replace(/-$/, '\u2013');   // the printed edition marks a syllable break with an en dash
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
        lp, geom, voiceStep: voiceHeights[0] || 91, isMarker: false, txt, secHeight, finalSecWidth, width: finalSecWidth, svgWidth,
        hasClef: geom.showClef, belowExtra, trimUnits, rawTop: 10, lyricShift, lyricWidth: textWidth,
      });
    });
    return out;
  }

  /** Splits a small-caps lyric into runs of equal size (first letter full size, the rest small). */
  private lyricRuns(txt: string, caps: 'all' | 'first'): { text: string; big: boolean }[] {
    const runs: { text: string; big: boolean }[] = [];
    let first = caps === 'first';
    for (const ch of Array.from(txt)) {
      const big = first && /\p{L}/u.test(ch);
      if (/\p{L}/u.test(ch)) first = false;
      const last = runs[runs.length - 1];
      if (last && last.big === big) last.text += ch; else runs.push({ text: ch, big });
    }
    return runs;
  }

  /** Width of a lyric in pt; all-caps syllables are measured as small capitals. */
  private lyricWidth(doc: jsPDF, fontFamily: string, txt: string, fs: number, caps?: 'all' | 'first'): number {
    doc.setFont(fontFamily, 'normal');
    if (!caps) { doc.setFontSize(fs); return doc.getTextWidth(txt); }
    let w = 0;
    for (const r of this.lyricRuns(txt, caps)) { doc.setFontSize(r.big ? fs : fs * SMALL_CAPS); w += doc.getTextWidth(r.text); }
    doc.setFontSize(fs);
    return w;
  }

  private drawLyric(doc: jsPDF, fontFamily: string, txt: string, x: number, y: number, fs: number, caps?: 'all' | 'first'): void {
    doc.setFont(fontFamily, 'normal');
    if (!caps) { doc.setFontSize(fs); doc.text(txt, x, y); return; }
    let cx = x;
    for (const r of this.lyricRuns(txt, caps)) {
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

  private async exportInner(jobs: PdfDocJob[], opts: PdfExportOptions): Promise<PdfExportStats> {
    if (!jobs.length) throw new Error('Nothing to print');
    const stats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, outline: [], timings: {} };
    const t0 = performance.now();
    /** Adds the time `fn` takes to the phase `name` (also for async work). */
    const timed = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
      const a = performance.now();
      try { return await fn(); } finally { stats.timings[name] = (stats.timings[name] || 0) + (performance.now() - a); }
    };
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
        const pdfMarginLeft = Number(s.pdfMarginLeft ?? PRINT_PDF_DEFAULTS.pdfMarginLeft);
        const pdfMarginRight = Number(s.pdfMarginRight ?? PRINT_PDF_DEFAULTS.pdfMarginRight);
        const pdfMarginTop = Number(s.pdfMarginTop ?? PRINT_PDF_DEFAULTS.pdfMarginTop);
        const pdfMarginBottom = Number(s.pdfMarginBottom ?? PRINT_PDF_DEFAULTS.pdfMarginBottom);
        const pdfStaffSpacing = Number(s.pdfStaffSpacing ?? PRINT_PDF_DEFAULTS.pdfStaffSpacing);
        const pdfBracketGap = Number(s.pdfBracketGap ?? 5);
        const pdfBracketTick = Number(s.pdfBracketTick ?? 4);
        const pdfSyllableTextOffset = Number(s.pdfSyllableTextOffset ?? PRINT_PDF_DEFAULTS.pdfSyllableTextOffset);
        const pdfTextBlockGap = Number(s.pdfTextBlockGap ?? 10);
        
        // Coerced layout parameters
        const titleFontSize = Number(s.pdfTitleFontSize ?? PRINT_PDF_DEFAULTS.pdfTitleFontSize);
        const pdfTitleVerticalSpace = Number(s.pdfTitleVerticalSpace ?? 20);
        const headerSource = s.pdfHeaderSource || 'textinitium';
        const metaFontSize = Number(s.pdfMetadataFontSize ?? PRINT_PDF_DEFAULTS.pdfMetadataFontSize);
        const pdfMetadataVerticalSpace = Number(s.pdfMetadataVerticalSpace ?? 15);
        const pdfBracketThickness = Number(s.pdfBracketThickness ?? 1.2);
        const pdfCommentTitleFontSize = Number(s.pdfCommentTitleFontSize ?? PRINT_PDF_DEFAULTS.pdfCommentTitleFontSize);
        const pdfVerticalSpace = Number(s.pdfVerticalSpace ?? PRINT_PDF_DEFAULTS.pdfVerticalSpace);
        const SCALE = Number(s.pdfScale ?? PRINT_PDF_DEFAULTS.pdfScale);
        const extraSyllableSpacing = Number(s.pdfSyllableSpacing ?? PRINT_PDF_DEFAULTS.pdfSyllableSpacing);
        const pdfContinuationIndent = Number(s.pdfContinuationIndent ?? PRINT_PDF_DEFAULTS.pdfContinuationIndent);
        const pdfFontSize = Number(s.pdfFontSize ?? PRINT_PDF_DEFAULTS.pdfFontSize);
        const pdfSignaturSpace = Number(s.pdfSignaturSpace ?? PRINT_PDF_DEFAULTS.pdfSignaturSpace);
        // Titles, metadata and paratexts share one left edge, set just inside the staff
        // start (print edition: staff at 83.7 pt, text at 89.1 pt).
        const textX = pdfMarginLeft + pdfSignaturSpace + PDF_TEXT_INSET;
        const notationColor = hexToRgb(sanitizeNotationColor(s.notationColor));
        const pdfParatextFontSize = Number(s.pdfParatextFontSize ?? PRINT_PDF_DEFAULTS.pdfParatextFontSize);
        const pdfParatextSpacing = Number(s.pdfParatextSpacing ?? PRINT_PDF_DEFAULTS.pdfParatextSpacing);
        const pdfCommentStaffScale = Number(s.pdfCommentStaffScale ?? s.pdfScale ?? PRINT_PDF_DEFAULTS.pdfScale);
        const pdfCommentFontSize = Number(s.pdfCommentFontSize ?? PRINT_PDF_DEFAULTS.pdfCommentFontSize);
        const pdfCommentTitleFontSizeActual = Number(s.pdfCommentTitleFontSize ?? PRINT_PDF_DEFAULTS.pdfCommentTitleFontSize);
        const pdfCommentBlockGap = Number(s.pdfCommentBlockGap ?? PRINT_PDF_DEFAULTS.pdfCommentBlockGap);
        const pdfShowPageNumbers = s.pdfShowPageNumbers === true || s.pdfShowPageNumbers === 'true';
        const pdfPageNumberFontSize = Number(s.pdfPageNumberFontSize ?? PRINT_PDF_DEFAULTS.pdfPageNumberFontSize);
        const pdfHeadlineFontSize = Number(s.pdfHeadlineFontSize ?? PRINT_PDF_DEFAULTS.pdfHeadlineFontSize);
        const pdfHeadlineMetadataFields = s.pdfHeadlineMetadataFields || [];

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
        let apparatusStarted = false;
        let apparatusPage = 0;
        const titleOf = (j: PdfDocJob) => metadataFieldValue(j.document, headerSource) || j.document.textinitium || 'New Document';
        const sourceLineOf = (j: PdfDocJob): string => {
          const src: any = j.source || {};
          return [src.bibliotheksort || src.herkunftsort, src.bibliothek, src.bibliothekssignatur]
            .map((v: any) => (v || '').toString().trim()).filter(Boolean).join(', ');
        };
        // Framed number in the left margin. The print volume's own number (Band metadata) is
        // not used; the label is built from the manuscript and the document.
        const boxMode: PdfBoxLabel = s.pdfShowEditionBox === false ? 'none' : (opts.boxLabel || 'enumeration');
        const sigleOf = (j: PdfDocJob): string => (j.sigle || (j.source as any)?.quellensigle || '').toString().trim();
        const perManuscript = new Map<string, number>();
        const boxTexts: string[] = jobs.map((j) => {
          const sg = sigleOf(j);
          const n = (perManuscript.get(sg) || 0) + 1;
          perManuscript.set(sg, n);
          if (boxMode === 'enumeration') return [sg, n].filter((v) => v !== '').join(' ');
          if (boxMode === 'incipit') return [sg, (j.document.textinitium || '').trim().split(/\s+/)[0]].filter(Boolean).join(' ');
          if (boxMode === 'genre') return [j.document.gattung1 || genreOf(j.document), sg].filter(Boolean).join(' ');
          return '';
        });
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
              drawBox(boxTexts[ji], cursorY, fsH);
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
            drawBox(boxTexts[ji], cursorY, pdfFontSize);
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
                  doc, fontFamily, pdfFontSize, SCALE, extraSyllableSpacing, textOffset: pdfSyllableTextOffset, clefMode, firstSyllableUuid,
                }));
                // All-caps syllables ("SA– LUS") are set in small capitals; the first letter of a
                // word stays full size, the continuation of a hyphenated word is all small.
                let prevLyric = '';
                for (const m of measured) {
                  if (m.isMarker) continue;
                  if (m.txt && /\p{Lu}/u.test(m.txt) && !/\p{Ll}/u.test(m.txt) && (m.txt.match(/\p{L}/gu) || []).length >= 2) {
                    m.smallCaps = /[\u2013-]$/.test(prevLyric) ? 'all' : 'first';
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
                  // adiastematic lines have no staff, hence no clef either
                  clefMode: zeile.notation === 'adiastematic' ? 'document-start' as const : clefMode,
                };
                // Folio labels go right-aligned to the margin. A label whose system leaves
                // no room for it stays inline (and reserves its width); re-layout until stable.
                const inlineLabels = new Set<number>();
                let layout = layoutPdfLine([], layoutOpts);
                for (let attempt = 0; attempt < 6; attempt++) {
                  layout = layoutPdfLine(
                    measured.map((m, k) => ({
                      kind: m.isMarker ? 'marker' as const : 'syllable' as const,
                      width: m.width + (inlineLabels.has(k) ? 3 + (m.labelWidth || 0) : 0),
                      hasClef: m.hasClef,
                      breakAfterPreferred: !m.isMarker && measured[k + 1]?.isMarker === true,
                    })),
                    layoutOpts);
                  let changed = false;
                  const flushRight = new Set<number>(); // systems that already have a right-aligned label
                  measured.forEach((m, k) => {
                    if (!m.folioLabel || inlineLabels.has(k)) return;
                    const sysNo = layout.placed[k].system;
                    const sys = layout.systems[sysNo];
                    if (flushRight.has(sysNo) || sys.endX + 8 > layoutOpts.maxX - (m.labelWidth || 0)) { inlineLabels.add(k); changed = true; }
                    else flushRight.add(sysNo);
                  });
                  if (!changed) break;
                }
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
                  let h = 0, extra = 0;
                  for (let k = sys.first; k <= sys.last; k++) { h = Math.max(h, measured[k].secHeight); extra = Math.max(extra, measured[k].belowExtra || 0); }
                  return h > 0 ? h + extra - sysTrims[si] : 0;
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
                let staffDrawn = -1;
                const ensureStaff = (si: number) => {
                  if (staffDrawn === si) return;
                  staffDrawn = si;
                  if (adiastematicLine) return;
                  const sys = layout.systems[si];
                  const top = cursorY - (sysTrims[si] || 0) + (40 - sysRawTops[si]) * SCALE;
                  for (let v = 0; v < sysVoices[si].v; v++) drawStaff(doc, sys.startX, sys.endX, top + v * sysVoices[si].step * SCALE, SCALE, notationColor);
                };
                let curSystem = 0;
                stats.systems += layout.systems.length;
                stats.clefs += measured.filter((m) => m.hasClef).length + layout.placed.filter((pl) => pl.injectClef).length;
            
                for (let j = 0; j < measured.length; j++) {
                  const m = measured[j];
                  const pl = layout.placed[j];
                  const trim = sysTrims[pl.system] || 0;
                  const lpKind = m.lp.kind;
              
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
                    const tickTop = cursorY + h + pdfSyllableTextOffset - pdfFontSize * 0.78;
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
                      if (inlineLabels.has(j)) {
                        doc.text(m.folioLabel, rightEdge + 3, baselineY);
                        rightEdge += 3 + (m.labelWidth || 0);
                      } else {
                        doc.text(m.folioLabel, layoutOpts.maxX - (m.labelWidth || 0), baselineY);
                      }
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
              
                  // Print Signatur right-aligned before the first note of this line
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
                     lineHasLyrics = false;
                     lineHasBrackets = Object.keys(activeBrackets).length > 0;
                 
                     for (const key in activeBrackets) {
                         const b = activeBrackets[key];
                         b.startX = pl.x + m.lyricShift - 1;
                         b.startLineY = lineStartY;
                     }
                  }
              
                  lineMaxHeight = Math.max(lineMaxHeight, sysHeights[pl.system] || secHeight);
                  ensureStaff(pl.system);
                  if (pl.injectClef) {
                    drawGClef(doc, pl.clefX, cursorY - trim + (40 - sysRawTops[pl.system]) * SCALE, SCALE, notationColor);
                  }
                  cursorX = pl.x;
              
                  // Notes, brackets, ledger lines and the clef, drawn directly from the geometry
                  if (m.geom) {
                    const g = m.geom;
                    timedSync('draw', () => {
                      drawSyllableNotation(doc, g, { cellX: cursorX, rawTopY: cursorY - trim, rawTop: sysRawTops[pl.system], S: SCALE, voiceStep: m.voiceStep }, notationColor);
                      if (g.showClef) drawGClef(doc, cursorX, cursorY - trim + (40 - sysRawTops[pl.system]) * SCALE, SCALE, notationColor);
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
          const fs = pdfCommentFontSize;
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
          const head = Math.max(6, 40 - minTop + 3);
          const below = Math.max(14, low + 2 - 80);
          const hasText = items.some((it) => it.kind === 's' && !!it.txt);
          const rowH = (head + 40 + below) * Sc + (hasText ? fs * 1.3 : 0);
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
            w: Math.max(0, ...rows.map(rowW)), h: rows.length * rowH + (rows.length - 1) * 4,
            draw: (ox, oy) => rows.forEach((r, ri) => {
              const staffTop = oy + ri * (rowH + 4) + head * Sc;
              if (!adia && r.length) drawStaff(doc, ox, ox + rowW(r), staffTop, Sc, color);
              let cx = ox;
              for (const it of r) {
                if (it.kind === 's') {
                  drawSyllableNotation(doc, it.g, { cellX: cx, rawTopY: staffTop, rawTop: 40, S: Sc, voiceStep: 91 }, color);
                  if (it.txt) {
                    doc.setFont(fontFamily, 'normal');
                    doc.setFontSize(fs);
                    if (context) doc.setTextColor(150, 150, 150); else doc.setTextColor(0, 0, 0);
                    doc.text(it.txt, cx + it.shift, staffTop + (40 + below) * Sc + fs * 0.9);
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
            apparatusSpans.push({ job: ji, from: doc.getNumberOfPages() });
            if (multi) {
                // each document gets its own sub-heading: ID, incipit and genre
                checkPageOverflow(46);
                cursorY += 6;
                doc.setFontSize(pdfCommentFontSize + 1);
                doc.setFont(fontFamily, 'bold');
                doc.setTextColor(0, 0, 0);
                const idText = job.document.dokumenten_id || '';
                doc.text(idText, textX, cursorY + pdfCommentFontSize);
                let hx = textX + doc.getTextWidth(idText) + 8;
                doc.setFont(fontFamily, 'italic');
                const incipit = job.document.textinitium || '';
                doc.text(incipit, hx, cursorY + pdfCommentFontSize);
                hx += doc.getTextWidth(incipit) + 8;
                const gen = genreOf(job.document);
                if (gen) {
                    doc.setFont(fontFamily, 'normal');
                    doc.setTextColor(PDF_KEY_GREY, PDF_KEY_GREY, PDF_KEY_GREY);
                    doc.text(gen, hx, cursorY + pdfCommentFontSize);
                    doc.setTextColor(0, 0, 0);
                }
                cursorY += pdfCommentFontSize * 1.9 + 3;
            }

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
              gapX: 9,
              gapY: 5,
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

                // break into lines (words keep the style of their segment)
                type Word = Seg & { width: number; gapBefore: number };
                const lines: Word[][] = [[]];
                let x = 0;
                doc.setFont(fontFamily, 'normal'); doc.setFontSize(fs);
                const spaceW = doc.getTextWidth(' ');
                segs.forEach((seg, si) => {
                    const startsWithSpace = /^\s/.test(seg.w);
                    const words = seg.w.split(/\s+/).filter(Boolean);
                    words.forEach((w, wi) => {
                        doc.setFont(fontFamily, seg.style); doc.setFontSize(seg.size);
                        const width = doc.getTextWidth(w);
                        const first = lines[lines.length - 1].length === 0;
                        // a segment glues to the previous one when no whitespace separates them
                        const glue = !first && wi === 0 && si > 0 && !startsWithSpace && !seg.sep && !/\s$/.test(segs[si - 1].w) && seg.style !== 'normal';
                        const gap = first ? 0 : glue ? 0 : spaceW;
                        if (!first && x + gap + width > textColumnW) { lines.push([]); x = 0; lines[lines.length - 1].push({ ...seg, w, width, gapBefore: 0 }); x = width; }
                        else { lines[lines.length - 1].push({ ...seg, w, width, gapBefore: gap }); x += gap + width; }
                    });
                });
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


            // An entry whose body is a comment tree or a set of lines: the lemma line (as for text
            // entries), then the tree / the lines below it.
            const drawStructuredEntry = (c: VM.Comment, body: Box) => {
              drawTextEntry({ ...c, text: '' } as VM.Comment);
              cursorY -= pdfCommentBlockGap - 2;
              placeBox(body, 8);
              cursorY += pdfCommentBlockGap + 2;
            };
            const linesBox = (c: VM.Comment): Box => {
              const parts: Box[] = [];
              (c.lines || []).forEach((line: any, j: number) => {
                const siglum = c.readingWitnesses?.[j];
                if (siglum) {
                  const w = textKit.width(siglum, 'bold', pdfCommentFontSize - 0.5);
                  parts.push({ w, h: pdfCommentFontSize * 1.3, draw: (x, y) => textKit.draw(siglum, x, y + pdfCommentFontSize, 'bold', pdfCommentFontSize - 0.5) });
                }
                if (line.kind === VM.ContainerKind.ZeileContainer) parts.push(inlineZeileBox(line, false, textColumnW - 8));
                else if (line.kind === VM.ContainerKind.ParatextContainer && line.text) {
                  const ls = breakLines([{ w: line.text, style: 'normal', size: pdfCommentFontSize }], textColumnW - 8, textKit);
                  parts.push({ w: linesWidth(ls), h: ls.length * pdfCommentFontSize * 1.38, draw: (x, y) => drawLines(ls, x, y + pdfCommentFontSize, pdfCommentFontSize * 1.38, textKit) });
                }
              });
              const h = parts.reduce((a, p) => a + p.h + 3, 0);
              return { w: Math.max(0, ...parts.map((p) => p.w)), h, draw: (x, y) => { let cy = y; for (const p of parts) { p.draw(x, cy, p.h); cy += p.h + 3; } } };
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
              cursorY += pdfCommentBlockGap + 4;
            }
            const ordered = (job.cont.comments || [])
              .map((c, i) => ({ c, i, pos: commentStartIndex(jobParts, c) }))
              .sort((x, y) => (x.pos - y.pos) || (x.i - y.i));
            for (const { c } of ordered) {
              const type = commentType(c);
              if (type === 'tree' && c.tree) drawStructuredEntry(c, layoutCommentTree(c.tree, treeKit, textColumnW - 8));
              else if (type === 'lines' && c.lines) drawStructuredEntry(c, linesBox(c));
              else drawTextEntry(c);
            }
        };

        // ── Render, lay out, then the apparatus ─────────────────────────────────────────────
        for (let ji = 0; ji < jobs.length; ji++) {
          opts.onProgress?.('Rendering ' + (jobs[ji].document.dokumenten_id || jobs[ji].document.textinitium || ''), ji, jobs.length);
          if (ji > 0) {
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
          await layoutDocument(jobs[ji], ji);
        }
        if (opts.apparatus) {
          for (let ji = 0; ji < jobs.length; ji++) {
            opts.onProgress?.('Apparatus ' + (jobs[ji].document.dokumenten_id || ''), ji, jobs.length);
            await drawApparatusFor(jobs[ji], ji);
          }
        }
        stats.documents = docEntries.map((e) => ({ id: jobs[e.job].document.dokumenten_id || '', page: e.page }));
        stats.apparatusPage = apparatusStarted ? apparatusPage : 0;

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
            type Row = { id: string; incipit: string; genre: string; page: number; plain?: boolean };
            const rows: Row[] = docEntries.map((e) => {
              const j = jobs[e.job];
              return { id: j.document.dokumenten_id || '', incipit: j.document.textinitium || '', genre: genreOf(j.document), page: e.page };
            });
            if (apparatusStarted) rows.push({ id: '', incipit: 'Critical Apparatus', genre: '', page: apparatusPage, plain: true });
            if (y + 40 > maxContentY) y = startNewTitlePage();
            y = drawHeading('Contents', textX, y, textColumnW, 10) + 6;
            doc.setFont(fontFamily, 'normal');
            doc.setFontSize(pdfFontSize);
            const idW = Math.min(130, Math.max(0, ...rows.filter((r) => !r.plain).map((r) => doc.getTextWidth(r.id))) + 16);
            const lineH = pdfFontSize * 1.6;
            for (const r of rows) {
              if (y + lineH > maxContentY) y = startNewTitlePage();
              doc.setFont(fontFamily, 'normal');
              doc.setFontSize(pdfFontSize);
              doc.setTextColor(0, 0, 0);
              const pageStr = String(r.page);
              const pageX = pageWidth - pdfMarginRight - doc.getTextWidth(pageStr);
              const x1 = r.plain ? textX : textX + idW;
              if (!r.plain) doc.text(r.id, textX, y);
              // incipit, then the genre in light grey; both cut to what fits before the leader
              let incipit = r.incipit;
              const room = pageX - x1 - 24;
              while (incipit.length > 1 && doc.getTextWidth(incipit) > room) incipit = incipit.slice(0, -1);
              if (incipit !== r.incipit) incipit = incipit.trimEnd() + '…';
              doc.text(incipit, x1, y);
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
              stats.outline.push({ label: [r.id, r.incipit, r.genre].filter(Boolean).join(' | '), page: r.page });
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
