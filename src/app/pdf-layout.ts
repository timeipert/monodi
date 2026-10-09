import { ClefDisplayMode, shouldShowClef } from './clef-policy';

/**
 * Pure line-breaking for the PDF export (no DOM, no jsPDF), so it can be tested
 * with synthetic and real documents.
 *
 * One ZeileContainer is a sequence of measured items. They are laid out left to
 * right; when the next syllable would cross the right margin a new *system*
 * starts. Like in the printed edition, continuation systems are indented, carry
 * no clef unless `clefMode` asks for it, and prefer to break at a caesura.
 */
export interface PdfLayoutItem {
  /** `syllable` may trigger a wrap; a `marker` (line/folio change) never does. */
  kind: 'syllable' | 'marker';
  /** Width in pt, including a clef already baked into the item's SVG. */
  width: number;
  /** The item's own SVG already contains the clef (so none is injected). */
  hasClef?: boolean;
  /** A caesura follows this item: a good place to break a system. */
  breakAfterPreferred?: boolean;
}

export interface PdfLayoutOptions {
  startX: number;
  maxX: number;
  continuationIndent: number;
  /** Width in pt of a clef injected at the start of a wrapped system. */
  clefWidth: number;
  clefMode: ClefDisplayMode;
  /** Share of the system width (from the right) in which a caesura break is preferred. */
  caesuraSlack?: number;
}

export interface PlacedItem {
  index: number;
  x: number;
  system: number;
  /** Draw a clef (+ staff) of `clefWidth` immediately before this item at `clefX`. */
  injectClef: boolean;
  clefX: number;
}

export interface PdfSystem {
  first: number;
  last: number;
  startX: number;
  endX: number;
}

export interface PdfLayoutResult {
  placed: PlacedItem[];
  systems: PdfSystem[];
}

export function layoutPdfLine(items: PdfLayoutItem[], o: PdfLayoutOptions): PdfLayoutResult {
  const slack = o.caesuraSlack ?? 0.35;
  const n = items.length;
  if (n === 0) return { placed: [], systems: [] };

  const systemStartX = (sys: number) => (sys === 0 ? o.startX : o.startX + o.continuationIndent);
  const lead = (sys: number, itemIdx: number): number => {
    if (sys === 0) return 0;
    const show = shouldShowClef(o.clefMode, { firstInDocument: false, firstInZeile: false, afterLineChange: false, wrapStart: true });
    return show && !items[itemIdx].hasClef ? o.clefWidth : 0;
  };

  // 1. Find the system starts.
  const starts: number[] = [0];
  let i = 0;
  let x = systemStartX(0) + lead(0, 0);
  const xAfter: number[] = new Array(n);
  while (i < n) {
    const sysStart = starts[starts.length - 1];
    const it = items[i];
    if (it.kind === 'syllable' && i > sysStart && x + it.width > o.maxX) {
      const sys = starts.length - 1;
      const left = systemStartX(sys);
      let b = i;
      for (let k = i - 1; k > sysStart; k--) {
        if (items[k].breakAfterPreferred && xAfter[k] - left >= (1 - slack) * (o.maxX - left)) {
          b = k + 1;
          // markers (line/folio change) that follow the caesura end this system
          while (b < i && items[b].kind === 'marker') b++;
          break;
        }
      }
      starts.push(b);
      i = b;
      x = systemStartX(starts.length - 1) + lead(starts.length - 1, b);
      continue;
    }
    x += it.width;
    xAfter[i] = x;
    i++;
  }

  // 2. Assign positions.
  const placed: PlacedItem[] = [];
  const systems: PdfSystem[] = [];
  for (let s = 0; s < starts.length; s++) {
    const first = starts[s];
    const last = (s + 1 < starts.length ? starts[s + 1] : n) - 1;
    const startX = systemStartX(s);
    let cx = startX;
    const l = lead(s, first);
    for (let k = first; k <= last; k++) {
      const injectClef = k === first && l > 0;
      const clefX = cx;
      if (injectClef) cx += l;
      placed.push({ index: k, x: cx, system: s, injectClef, clefX });
      cx += items[k].width;
    }
    systems.push({ first, last, startX, endX: cx });
  }
  return { placed, systems };
}
