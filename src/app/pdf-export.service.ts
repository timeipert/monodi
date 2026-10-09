import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import * as VM from './types/model';
import { Document, ProjectSettings, Source } from './api.service';
import { embeddedFamily, registerEmbeddedFont } from './pdf-font';
import { PRINT_PDF_DEFAULTS, pdfPageFormat } from './pdf-defaults';
import { G_CLEF_PATH } from './clef-glyph';
import { layoutPdfLine } from './pdf-layout';
import { sanitizeNotationColor } from './notation-color';
import { sanitizeClefDisplayMode } from './clef-policy';
import { commentLemma, commentStartIndex, commentType } from './comment-lemma';
import { genreOf, headlineText as buildHeadline, inlineMetadataItems, metadataFieldValue } from './document-metadata';
import { getCategoryDetails } from './comment/comment-categories';
import { FocusService } from './focus.service';
import { minNoteYOf, requiredPadTop } from './notes/Drawables';

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
  part: HTMLElement;
  isMarker: boolean;
  svgs: ArrayLike<SVGElement> | NodeListOf<SVGSVGElement>;
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

export interface PdfExportOptions {
  settings: ProjectSettings | null;
  /** A title page (always present for several documents). */
  titlePage: boolean;
  /** Metadata: a table on the title page (one document) / a line under each document's title. */
  includeMetadata: boolean;
  /** The collected critical apparatus. */
  apparatus: boolean;
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
}

/** The hidden DOM in which one document at a time is rendered for measuring and drawing. */
export interface PdfRenderHost {
  element: HTMLElement;
  render(job: PdfDocJob, settings?: ProjectSettings | null): Promise<void>;
  /** Empties the host again. */
  clear(): void;
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  private host: PdfRenderHost | null = null;
  lastStats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, outline: [] };

  constructor(private focus: FocusService) {}

  registerHost(host: PdfRenderHost | null): void { this.host = host; }
  get hasHost(): boolean { return !!this.host; }

  /** Measure one `app-notes` / `app-line-change` / `app-folio-change` element for
   *  the PDF layout. Returns null for parts without a drawable section. */
  private measurePdfPart(part: HTMLElement, doc: jsPDF, fontFamily: string, pdfFontSize: number,
                         SCALE: number, extraSyllableSpacing: number, textOffset: number): PdfMeasuredPart | null {
    const tagName = part.tagName.toLowerCase();
    if (tagName === 'app-line-change' || tagName === 'app-folio-change') {
      const isFolio = tagName === 'app-folio-change';
      // Mirrors the marker drawing: gap, [second tick], gap + 2. The folio label is
      // set right-aligned at the margin when there is room (see the layout loop), so
      // it is not part of the width unless it has to stay inline.
      let width = 3 + 3 + 2;
      let folioLabel: string | undefined;
      let labelWidth = 0;
      if (isFolio) {
        width += PDF_MARKER_TICK_GAP;
        // Only the SVG text: the element's textContent repeats the label (note/syllable divs).
        folioLabel = (part.querySelector('svg text')?.textContent || '').trim() || undefined;
        if (folioLabel) {
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(pdfFontSize * 0.85);
          labelWidth = doc.getTextWidth(folioLabel);
          doc.setFontSize(pdfFontSize);
        }
      }
      return { part, isMarker: true, svgs: [], txt: '', secHeight: 0, finalSecWidth: width, width, svgWidth: 0, hasClef: false, folioLabel, labelWidth, lyricShift: 0, lyricWidth: 0 };
    }

    const sec = part.querySelector('.section') as HTMLElement | null;
    if (!sec) return null;
    const svgs = sec.querySelectorAll('svg');
    const textEl = sec.querySelector('.syllableText:not(.dnone)') as HTMLElement | null;

    let maxRawWidth = 50;
    let totalRawHeight = 0;
    let noteShiftUnits = -1; // -1: this part has no note group (boxes, missing notes)
    for (let v = 0; v < svgs.length; v++) {
      const s = svgs[v];
      let w = parseFloat(s.getAttribute('width') || '50');

      // Dynamic width check: inspect note image and slur path coordinates
      // to ensure we never truncate content if DOM attributes are too small or lag.
      let maxContentRight = 0;
      s.querySelectorAll('image').forEach(img => {
        const x = parseFloat(img.getAttribute('x') || '0');
        const width = parseFloat(img.getAttribute('width') || '12');
        if (x + width > maxContentRight) maxContentRight = x + width;
      });
      s.querySelectorAll('path').forEach(p => {
        const right = parseFloat(p.getAttribute('data-right') || '');
        if (Number.isFinite(right) && right > maxContentRight) maxContentRight = right;
      });
      if (maxContentRight > 0) {
        // The notes group is shifted right by 12 units (44 with a clef) — find that shift.
        let translateAmt = 12;
        s.querySelectorAll('g[transform]').forEach((g) => {
          const match = /^translate\(\s*([0-9.]+)\s*,\s*0\s*\)$/.exec(g.getAttribute('transform') || '');
          if (match) translateAmt = parseFloat(match[1]);
        });
        if (v === 0) noteShiftUnits = translateAmt;
        const contentWidth = maxContentRight + translateAmt + 8;
        if (contentWidth > w) w = contentWidth;
      }
      if (w > maxRawWidth) maxRawWidth = w;
      totalRawHeight += (s.getBoundingClientRect().height || 80);
    }
    if (svgs.length === 0) totalRawHeight = 80;

    const svgWidth = maxRawWidth * SCALE;
    const secHeight = totalRawHeight * SCALE;

    let txt = '';
    let textWidth = 0;
    if (textEl) {
      txt = textEl.innerText.trim();
      if (txt && txt !== 'X' && txt !== '...' && txt !== '<...>') {
        // The printed edition marks a syllable break with an en dash, not a hyphen.
        txt = txt.replace(/-$/, '\u2013');
        doc.setFontSize(pdfFontSize);
        doc.setFont(fontFamily, 'normal');
        textWidth = doc.getTextWidth(txt);
      } else {
        txt = '';
      }
    }
    // The lyric starts at the first note head (print edition), i.e. right of the clef.
    const lyricShift = noteShiftUnits >= 0 ? Math.max(0, noteShiftUnits - 0.5) * SCALE : 0;
    const finalSecWidth = Math.max(svgWidth, lyricShift + textWidth + extraSyllableSpacing - 12 * SCALE);

    // How much of the 30 units above the top staff line (y = 40) is actually needed:
    // note heads/stems, neume brackets and ledger lines above. The rest is trimmed so
    // systems sit as tight as in print; high notes or brackets keep their room.
    let trimUnits = 0;
    let rawTop = 10;
    if (svgs.length === 1) {
      let minTop = 40;
      svgs[0].querySelectorAll('image').forEach((img) => {
        minTop = Math.min(minTop, parseFloat(img.getAttribute('y') || '40') + 18); // stem top of an ascending note
      });
      svgs[0].querySelectorAll('path[data-right]').forEach((p) => {
        try { minTop = Math.min(minTop, (p as unknown as SVGGraphicsElement).getBBox().y - 1); } catch { /* not rendered */ }
      });
      svgs[0].querySelectorAll('rect').forEach((r) => {
        if (r.getAttribute('width') === '15px' && r.getAttribute('height') === '1px') {
          minTop = Math.min(minTop, parseFloat(r.getAttribute('y') || '40'));
        }
      });
      // Negative trim = very high notes: the system gets more room than the SVG itself has.
      const headroom = Math.max(PDF_MIN_HEADROOM_UNITS, 40 - minTop + 3);
      const rootG = svgs[0].querySelector('g[transform*="translate"]');
      const mt = /translate\(\s*0\s*,\s*(-?[0-9.]+)\s*\)/.exec(rootG?.getAttribute('transform') || '');
      if (mt) rawTop = -parseFloat(mt[1]);
      trimUnits = (40 - rawTop) - headroom;
    }

    // Ledger lines below the staff (rects 15 wide, 1 high at y = 90/100/110) must not
    // run into the syllable text: push the text down by what is missing.
    let lowestLedger = 0;
    sec.querySelectorAll('rect').forEach((r) => {
      if (r.getAttribute('width') === '15px' && r.getAttribute('height') === '1px') {
        lowestLedger = Math.max(lowestLedger, parseFloat(r.getAttribute('y') || '0') + 0.5);
      }
    });
    let belowExtra = 0;
    if (lowestLedger > 80) {
      const clearTop = SCALE * (lowestLedger - rawTop + 5);       // ledger line + note head, from svg top
      const textTop = secHeight + textOffset - pdfFontSize * 0.7; // cap height of the lyric
      belowExtra = Math.max(0, clearTop - textTop);
    }
    return {
      part, isMarker: false, svgs, txt, secHeight, finalSecWidth, width: finalSecWidth, svgWidth,
      hasClef: !!sec.querySelector('.auto-clef'), belowExtra, trimUnits, rawTop, lyricShift, lyricWidth: textWidth,
    };
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

  /** Staff + G-clef segment for a wrapped system (clef setting "every line break").
   *  Built as an SVG with the same geometry as the note SVGs and drawn through svg2pdf,
   *  so it matches the clef of the first system exactly. */
  private async drawPdfStaffClef(doc: jsPDF, x: number, top: number, width: number, SCALE: number, color: string, rawTop = 10): Promise<void> {
    const units = width / SCALE;
    const H = 101 - rawTop; // staff + clef plus the usual 21 units below the bottom line (91 in the standard layout)
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(units));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${units} ${H}`);
    svg.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', `translate(0, ${-rawTop})`);
    for (let ly = 40; ly <= 80; ly += 10) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '0'); line.setAttribute('x2', String(units));
      line.setAttribute('y1', String(ly)); line.setAttribute('y2', String(ly));
      line.setAttribute('stroke', color);
      g.appendChild(line);
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', G_CLEF_PATH);
    path.setAttribute('fill', color);
    g.appendChild(path);
    svg.appendChild(g);
    document.body.appendChild(svg);
    try {
      await doc.svg(svg, { x, y: top, width, height: H * SCALE });
    } finally {
      svg.remove();
    }
  }


  /**
   * Typesets one or several documents into one PDF like the printed edition. One document:
   * optional title page with metadata, then the edition and its apparatus. Several documents:
   * title page with a contents table (ID, incipit, genre), each document starting on a new
   * page, and one collected apparatus that is divided by document.
   */
  async exportDocuments(jobs: PdfDocJob[], opts: PdfExportOptions): Promise<PdfExportStats> {
    if (!this.host) throw new Error('PDF render host is not available');
    if (!jobs.length) throw new Error('Nothing to print');
    const hostEl = this.host.element;
    const stats: PdfExportStats = { clefs: 0, systems: 0, pages: 0, documents: [], apparatusPage: 0, outline: [] };
    this.lastStats = stats;
    const multi = jobs.length > 1;

    // The renderer reads these from the focus service; remember them for the editor behind us.
    const saved = { clef: this.focus.clefDisplayMode, color: this.focus.notationColor, first: this.focus.firstSyllableUuid, pad: this.focus.docPadTop };
    try {
        const s: any = opts.settings || {};
        const doc = new jsPDF({ unit: 'pt', format: pdfPageFormat(s.pdfFormat), orientation: (s.pdfOrientation || 'portrait') });
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


        this.focus.clefDisplayMode = sanitizeClefDisplayMode(s.clefDisplayMode);
        this.focus.notationColor = sanitizeNotationColor(s.notationColor);
        const useTitlePage = multi || opts.titlePage;
        let titlePageCount = 0;
        if (useTitlePage) {
          titlePageCount = 1;
          doc.addPage();
          cursorY = pdfMarginTop;
        }
        const editionPage = () => doc.getNumberOfPages() - titlePageCount;
        const docEntries: { job: number; page: number }[] = [];
        const editionSpans: { job: number; from: number; to: number }[] = [];
        const apparatusSpans: { job: number; from: number }[] = [];
        let apparatusStarted = false;
        let apparatusPage = 0;
        const titleOf = (j: PdfDocJob) => metadataFieldValue(j.document, headerSource) || j.document.textinitium || 'New Document';
        const sourceLineOf = (j: PdfDocJob): string => {
          const src: any = j.source || {};
          return [src.bibliotheksort || src.herkunftsort, src.bibliothek, src.bibliothekssignatur]
            .map((v: any) => (v || '').toString().trim()).filter(Boolean).join(', ');
        };
        const headOf = (ji: number): string => {
          const j = jobs[ji];
          const src: any = j.source || {};
          const siglum = (j.sigle || src.quellensigle || '').toString().trim();
          return [sourceLineOf(j), siglum].filter(Boolean).join(' | ')
            || buildHeadline(j.document, pdfHeadlineMetadataFields, opts.settings) || (j.document.dokumenten_id || '');
        };
        const ownerOf = (page: number): number => {
          for (const sp of editionSpans) if (page >= sp.from && page <= sp.to) return sp.job;
          let owner = 0;
          for (const sp of apparatusSpans) if (sp.from <= page) owner = sp.job;
          return owner;
        };

        // Headings share one style: small uppercase, letter-spaced, with a hairline rule.
        const drawHeading = (text: string, x: number, y: number, width: number, size = 9.5): number => {
          doc.setFont(fontFamily, 'normal');
          doc.setFontSize(size);
          doc.setTextColor(0, 0, 0);
          doc.text(text.toUpperCase(), x, y, { charSpace: 0.9 });
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(0.4);
          doc.line(x, y + 4, x + width, y + 4);
          return y + 4 + size * 1.6;
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
            doc.setFontSize(titleFontSize);
            doc.setFont(fontFamily, "normal");
            // The edition number ("Print Edition" field) stands framed in the left margin, level
            // with the first title line, as the chant numbers do in the printed edition.
            const editionNo = (job.document.druckausgabe || '').toString().trim();
            if (editionNo && s.pdfShowEditionBox !== false) {
              doc.setFontSize(pdfFontSize);
              const w = doc.getTextWidth(editionNo) + 7;
              doc.setLineWidth(0.5);
              doc.setDrawColor(0, 0, 0);
              doc.rect(pdfMarginLeft, cursorY - pdfFontSize * 0.82 - 2, w, pdfFontSize + 4);
              doc.text(editionNo, pdfMarginLeft + 3.5, cursorY);
              doc.setFontSize(titleFontSize);
            }
            for (const line of doc.splitTextToSize(headerText, Math.max(60, pageWidth - pdfMarginRight - textX))) {
              checkPageOverflow(titleLineH);
              doc.text(line, textX, cursorY);
              cursorY += titleLineH;
            }
            cursorY += Math.max(0, pdfTitleVerticalSpace - titleLineH);
            checkPageOverflow(0);

            // Metadata inline, styled & dense
            if (opts.includeMetadata) {
              doc.setFontSize(metaFontSize);
          
              const items = inlineMetadataItems(job.document, opts.settings);
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

              cursorY = curY + pdfMetadataVerticalSpace;
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
        
            // Grab all app-containers in document order, only from the main document area
            const containers = hostEl.querySelectorAll('app-root-section .app-container');
        
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

            for (let i = 0; i < containers.length; i++) {
              const container = containers[i] as HTMLElement;
          
              // Calculate indentation based on left padding/margin of parent .child elements
              let paddingLeft = 0;
              let currentElement: HTMLElement | null = container;
              while (currentElement) {
                  if (currentElement.classList && currentElement.classList.contains('child')) {
                      paddingLeft += 20;
                  }
                  currentElement = currentElement.parentElement;
              }
          
              // structural text xOffset
              const xOffset = pdfMarginLeft + paddingLeft;

              // Only look inside the immediate content-row, not inside nested .children
              const firstDiv = container.children[0];
              if (!firstDiv) continue;
          
              const contentRow = firstDiv.querySelector('.content-row') as HTMLElement;
              if (!contentRow) continue;
          
              // 1. Check for Signatur
              const formteilDivs = contentRow.querySelectorAll('.formteil-line > div');
              let rowSignature = '';
              for (let k = 0; k < formteilDivs.length; k++) {
                 const fDiv = formteilDivs[k] as HTMLElement;
                 if (fDiv.innerText && fDiv.innerText.indexOf("Signatur") !== -1) {
                     const input = fDiv.querySelector('input');
                     if (input && input.value.trim()) {
                         currentSignatures.push(input.value.trim());
                         rowSignature = input.value.trim();
                     }
                 }
              }

              // Add vertical space ONLY if this is a FormteilContainer (level section)
              if (contentRow.classList.contains('formteil-section')) {
                if (!wasLastElementParatext) {
                  checkPageOverflow(pdfVerticalSpace);
                  cursorY += pdfVerticalSpace;
                }
                wasLastElementParatext = false;
              }
          
              // Check if this row is a Zeile (contains musical notes)
              const parts = contentRow.querySelectorAll('app-notes, app-line-change, app-folio-change');
          
              if (parts.length > 0) {
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
                const entries = Array.from(parts).map((pt) => this.measurePdfPart(pt as HTMLElement, doc, fontFamily, pdfFontSize, SCALE, extraSyllableSpacing, pdfSyllableTextOffset));
                const measured = entries.filter((e): e is PdfMeasuredPart => e !== null);
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
                  clefMode: Array.from(parts).some((pt) => pt.querySelector('line')) ? this.focus.clefDisplayMode : 'document-start' as const,
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
                let curSystem = 0;
                stats.systems += layout.systems.length;
                stats.clefs += measured.filter((m) => m.hasClef).length + layout.placed.filter((pl) => pl.injectClef).length;
            
                for (let j = 0; j < measured.length; j++) {
                  const m = measured[j];
                  const pl = layout.placed[j];
                  const trim = sysTrims[pl.system] || 0;
                  const part = m.part;
                  const tagName = part.tagName.toLowerCase();
              
                  if (tagName === 'app-line-change' || tagName === 'app-folio-change') {
                    // Manuscript line/folio breaks: a short vertical tick (or two, for a
                    // folio change) hanging just below the staff — matching the on-screen
                    // look. They must NOT wrap the PDF line; only ZeileContainer boundaries
                    // start a new staff line.
                    const isFolio = tagName === 'app-folio-change';
                    const gap = 3;
                    cursorX = pl.x;
                    // Keep the staff running through the marker (the printed edition's
                    // system is continuous); adiastematic lines have no staff.
                    if (part.querySelector('line')) {
                      doc.setDrawColor(notationColor[0], notationColor[1], notationColor[2]);
                      doc.setLineWidth(0.4);
                      for (let ly = 40; ly <= 80; ly += 10) {
                        const y = cursorY - trim + (ly - sysRawTops[pl.system]) * SCALE;
                        doc.line(cursorX, y, cursorX + m.width, y);
                      }
                    }
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
              
                  const { svgs, txt, secHeight, finalSecWidth } = m;
                  if (txt) lineHasLyrics = true;


                  const partUuid = part.getAttribute('data-uuid');
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
                  if (pl.injectClef) {
                    await this.drawPdfStaffClef(doc, pl.clefX, cursorY - trim, PDF_CLEF_WIDTH * SCALE, SCALE, sanitizeNotationColor(s.notationColor), sysRawTops[pl.system]);
                  }
                  cursorX = pl.x;
              
                  // Draw SVGs
                  if (svgs.length > 0) {
                    // High notes need more room than the SVG has: widen its view upwards (the
                    // SVG would clip them) and start the drawing that much higher.
                    const topExtra = trim < 0 ? -trim / SCALE : 0;
                    let currentSvgY = cursorY - trim - topExtra * SCALE;
                    for (let v = 0; v < svgs.length; v++) {
                      const svg = svgs[v];
                      const rawHeight = svg.getBoundingClientRect().height || 80;
                      const extra = v === 0 ? topExtra : 0;
                      const svgSecHeight = (rawHeight + extra) * SCALE;
                      const originalViewBox = svg.getAttribute('viewBox');
                      if (!originalViewBox) {
                        const finalRawWidth = finalSecWidth / SCALE;
                        svg.setAttribute('viewBox', `0 ${-extra} ${finalRawWidth} ${rawHeight + extra}`);
                      }
                  
                      await doc.svg(svg, { x: cursorX, y: currentSvgY, width: finalSecWidth, height: svgSecHeight });
                      currentSvgY += svgSecHeight;
                  
                      if (!originalViewBox) {
                        svg.removeAttribute('viewBox');
                      }
                    }
                  }
              
                  // Draw Syllable Text below the SVG
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
            
              } else {
                // Normal Text / Paratext
                const contentDiv = contentRow.querySelector('.after-dragger > div:not(.type-identifier)');
                const textEl = contentDiv ? contentDiv.querySelector('textarea, span') : null;
            
                let txt = "";
                if (textEl && textEl.tagName.toLowerCase() === 'textarea') {
                  txt = (textEl as HTMLTextAreaElement).value.trim();
                } else if (textEl) {
                   txt = (textEl as HTMLElement).innerText.trim();
                }
            
                if (txt) {
                  doc.setFontSize(pdfParatextFontSize);
                  doc.setFont(fontFamily, "normal");
              
                  const splitText = doc.splitTextToSize(txt, Math.max(60, pageWidth - pdfMarginRight - textX));
                  // Keep with next: a rubric (or a run of rubrics) must not be left alone at the
                  // bottom of a page — the first system that follows has to fit with it.
                  let followNeed = 0;
                  for (let k = i + 1; k < Math.min(containers.length, i + 8); k++) {
                    const row = (containers[k] as HTMLElement).children[0]?.querySelector('.content-row') as HTMLElement | null;
                    if (!row) continue;
                    if (row.querySelector('app-notes')) { followNeed += 55; break; }
                    if (row.classList.contains('formteil-section')) continue;
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
        const drawApparatusFor = async (job: PdfDocJob, ji: number) => {
          const jobParts = VM.getAllLineParts(job.cont);
        // Critical apparatus: one entry per comment in text order, each cited by the text its
        // grey corner marks frame ("lemma] comment"), as in the printed edition.
        const commentsArea = hostEl.querySelector('#pdf-comments-render-area') as HTMLElement | null;
        const hasComments = (job.cont.comments && job.cont.comments.length > 0) || job.cont.globalComment;
        if (commentsArea && hasComments) {
            if (!apparatusStarted) {
                // the apparatus starts on a page of its own, after all editions
                doc.addPage();
                cursorY = pdfMarginTop;
                apparatusPage = editionPage();
                apparatusStarted = true;
                cursorY = drawHeading('Critical Apparatus', textX, cursorY + 6, textColumnW, 10.5) + 4;
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

            // Entries whose content is a tree or a set of lines are rendered from the DOM.
            const drawDomBlock = async (block: HTMLElement) => {
            const blockRect = block.getBoundingClientRect();
            const blockWidth = blockRect.width > 0 ? blockRect.width : 1000;
            const maxScale = pdfCommentStaffScale;
            const SCALE_C = Math.min(maxScale, (pageWidth - textX - pdfMarginRight) / blockWidth);
            
            const bHeight = blockRect.height * SCALE_C;
            if (cursorY + bHeight > maxContentY) {
                doc.addPage();
                cursorY = pdfMarginTop;
            }

            // Draw each element relative to the block
            const elementsToDraw = block.querySelectorAll('textarea, svg, .bracket, h4, span.text, .syllableText:not(.dnone), .app-index, .app-category, .app-witness-siglum');
            for (let j = 0; j < elementsToDraw.length; j++) {
                const el = elementsToDraw[j] as HTMLElement;
                const elRect = el.getBoundingClientRect();
                
                const relX = elRect.left - blockRect.left;
                const relY = elRect.top - blockRect.top;
                
                const sRelX = relX * SCALE_C;
                const sRelY = relY * SCALE_C;
                const drawX = textX + sRelX;
                const drawY = cursorY + sRelY;
                
                if (el.tagName.toLowerCase() === 'svg') {
                    const rawWidth = parseFloat(el.getAttribute('width') || elRect.width.toString() || '50');
                    const rawHeight = elRect.height > 0 ? elRect.height : 100;
                    const svgWidth = rawWidth * SCALE_C;
                    const svgHeight = rawHeight * SCALE_C;
                    const originalViewBox = el.getAttribute('viewBox');
                    if (!originalViewBox) {
                        el.setAttribute('viewBox', `0 0 ${rawWidth} ${rawHeight}`);
                    }
                    await doc.svg(el as unknown as SVGElement, { x: drawX, y: drawY, width: svgWidth, height: svgHeight });
                    if (!originalViewBox) {
                        el.removeAttribute('viewBox');
                    }
                } 
                else if (el.classList.contains('syllableText')) {
                    const val = el.innerText.trim();
                    if (val && val !== "X" && val !== "..." && val !== "<...>") {
                        doc.setFontSize(pdfCommentFontSize);
                        doc.setFont(fontFamily, "normal");
                        doc.text(val, drawX, drawY + pdfCommentFontSize);
                    }
                }
                else if (el.tagName.toLowerCase() === 'span' && el.classList.contains('app-index')) {
                    // the lemma of tree/lines entries, set like the one of text entries (roman)
                    doc.setFontSize(pdfCommentFontSize);
                    doc.setFont(fontFamily, 'normal');
                    doc.setTextColor(0, 0, 0);
                    doc.text(el.innerText.trim(), drawX, drawY + pdfCommentFontSize);
                }
                else if (el.tagName.toLowerCase() === 'textarea' || el.tagName.toLowerCase() === 'span') {
                    let val = "";
                    if (el.tagName.toLowerCase() === 'textarea') {
                        val = (el as HTMLTextAreaElement).value.trim();
                    } else {
                        val = el.innerText.trim();
                    }
                    if (val) {
                        const commentLineHeight = pdfCommentFontSize * 1.4;
                        const rightBoundary = pageWidth - pdfMarginRight;
                        let curX = drawX;
                        let textY = drawY + pdfCommentFontSize + 2;
                        const tokens = val.split(/(\(\(.*?\)\)|\{\{.*?\}\}|\[\[.*?\]\])/g);
                        
                        // Word-wrap helper: splits text into words and wraps at rightBoundary
                        const wrapAndDraw = (text: string, fontStyle: string, fontSize: number, isBoxed: boolean) => {
                          doc.setFontSize(fontSize);
                          doc.setFont(fontFamily, fontStyle);
                          // Split on whitespace, keeping the spaces as tokens
                          const words = text.split(/(\s+)/);
                          for (const word of words) {
                            if (!word) continue;
                            const wordWidth = doc.getTextWidth(word);
                            // Wrap if the word would overflow (but only if we've advanced past the left margin)
                            if (curX + wordWidth > rightBoundary && curX > drawX + 1) {
                              curX = drawX;
                              textY += commentLineHeight;
                            }
                            doc.text(word, curX, textY);
                            if (isBoxed) {
                              doc.setLineWidth(0.2);
                              doc.rect(curX - 1, textY - fontSize, wordWidth + 2, fontSize + 2);
                            }
                            curX += wordWidth;
                          }
                        };
                        
                        for (const token of tokens) {
                            if (!token) continue;
                            if (token.startsWith('((')) {
                                const t = token.replace(/\(\(|\)\)/g, '');
                                wrapAndDraw(t, 'normal', pdfCommentFontSize, false);
                            } else if (token.startsWith('[[')) {
                                const t = token.replace(/\[\[|\]\]/g, '').toUpperCase();
                                wrapAndDraw(t, 'bold', pdfCommentFontSize - 1, false);
                            } else if (token.startsWith('{{')) {
                                const t = token.replace(/\{\{|\}\}/g, '');
                                wrapAndDraw(t, 'normal', pdfCommentFontSize, true);
                            } else {
                                wrapAndDraw(token, 'italic', pdfCommentFontSize, false);
                            }
                        }
                    }
                }
                else if (el.tagName.toLowerCase() === 'h4' || el.classList.contains('app-index')) {
                    const val = el.innerText.trim();
                    // sub-headings ("Global comment"): small, uppercase, letter-spaced, grey
                    doc.setFontSize(pdfCommentFontSize - 0.5);
                    doc.setFont(fontFamily, 'normal');
                    doc.setTextColor(PDF_KEY_GREY - 40, PDF_KEY_GREY - 40, PDF_KEY_GREY - 40);
                    doc.text(val.toUpperCase(), drawX, drawY + pdfCommentFontSize, { charSpace: 0.7 });
                    doc.setTextColor(0, 0, 0);
                }
                else if (el.classList.contains('app-category')) {
                    const val = el.innerText.trim();
                    doc.setFontSize(pdfCommentTitleFontSizeActual);
                    doc.setFont(fontFamily, "italic");
                    doc.text(val, drawX, drawY + pdfCommentTitleFontSizeActual);
                }
                else if (el.classList.contains('app-witness-siglum')) {
                    const val = el.innerText.trim();
                    doc.setFontSize(pdfCommentFontSize);
                    doc.setFont(fontFamily, "bold");
                    doc.text(val, drawX, drawY + pdfCommentFontSize);
                }
                else if (el.classList.contains('bracket')) {
                    const bWidth = elRect.width * SCALE_C;
                    const bHeight = elRect.height * SCALE_C;
                    doc.setDrawColor(PDF_CORNER_GREY, PDF_CORNER_GREY, PDF_CORNER_GREY);
                    doc.setLineWidth(PDF_CORNER_WIDTH);
                    doc.line(drawX, drawY, drawX + bWidth, drawY); // top
                    doc.line(drawX + bWidth, drawY, drawX + bWidth, drawY + bHeight); // right
                    doc.line(drawX + bWidth, drawY + bHeight, drawX, drawY + bHeight); // bottom
                }
            }
            
            cursorY += bHeight + pdfCommentBlockGap;
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

            const globalBlock = commentsArea.querySelector('.pdf-global-comment') as HTMLElement | null;
            if (globalBlock) await drawDomBlock(globalBlock);
            const blocksByIdx = new Map<number, HTMLElement>();
            commentsArea.querySelectorAll('.pdf-comment-block[data-idx]').forEach((el) => blocksByIdx.set(Number((el as HTMLElement).dataset['idx']), el as HTMLElement));
            const allParts = jobParts;
            const ordered = (job.cont.comments || [])
              .map((c, i) => ({ c, i, pos: commentStartIndex(allParts, c) }))
              .sort((x, y) => (x.pos - y.pos) || (x.i - y.i));
            for (const { c, i } of ordered) {
                if (commentType(c) === 'text') drawTextEntry(c);
                else { const el = blocksByIdx.get(i); if (el) await drawDomBlock(el); }
            }
        }

        };

        // ── Render, lay out, then the apparatus ─────────────────────────────────────────────
        for (let ji = 0; ji < jobs.length; ji++) {
          opts.onProgress?.('Rendering ' + (jobs[ji].document.dokumenten_id || jobs[ji].document.textinitium || ''), ji, jobs.length);
          await this.host.render(jobs[ji], opts.settings);
          if (ji > 0) { doc.addPage(); cursorY = pdfMarginTop; }
          docEntries.push({ job: ji, page: editionPage() });
          const from = doc.getNumberOfPages();
          await layoutDocument(jobs[ji], ji);
          editionSpans.push({ job: ji, from, to: doc.getNumberOfPages() });
        }
        if (opts.apparatus) {
          for (let ji = 0; ji < jobs.length; ji++) {
            const c = jobs[ji].cont;
            if (!((c.comments && c.comments.length) || c.globalComment)) continue;
            opts.onProgress?.('Apparatus ' + (jobs[ji].document.dokumenten_id || ''), ji, jobs.length);
            await this.host.render(jobs[ji], opts.settings);
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

          if (multi) {
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
        doc.save(opts.fileName || (multi ? 'Documents.pdf' : 'Document_' + (jobs[0].document.dokumenten_id || 'Export') + '.pdf'));
        return stats;
    } finally {
      this.focus.clefDisplayMode = saved.clef;
      this.focus.notationColor = saved.color;
      this.focus.firstSyllableUuid = saved.first;
      this.focus.docPadTop = saved.pad;
      this.host?.clear();
    }
  }
}
