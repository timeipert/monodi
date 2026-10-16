/**
 * Page-break rules of the print (typographic orphans and widows), independent of jsPDF so that
 * they can be tested with synthetic and extreme cases.
 *
 * Vocabulary: an item "leads" another when it must not stand alone at the bottom of a page —
 * a document heading with its metadata and rubrics leads the first system; an apparatus
 * heading leads its first entry.
 */

/** Something drawn later, once it is known whether it fits on the page together with what follows. */
export interface LeadItem {
  /** Height it takes. */
  h: number;
  draw(): void;
  /** A gap that is left out at the top of a page. */
  dropAtTop?: boolean;
}

export interface PageBox { top: number; bottom: number }

/** Is the cursor at the top of a page (nothing drawn yet)? */
export function atPageTop(cursorY: number, page: PageBox): boolean {
  return cursorY <= page.top + 1;
}

/**
 * Must a page break come before something `total` high? Not on a fresh page (it would not help),
 * and not when it is higher than a whole page (it can never fit; breaking would only waste a page).
 */
export function needsBreak(cursorY: number, total: number, page: PageBox): boolean {
  if (atPageTop(cursorY, page)) return false;
  return cursorY + total > page.bottom && total <= page.bottom - page.top;
}

/**
 * How many systems of a line (Zeile) with `n` systems must be on one page when system `k` (0-based)
 * is placed, so that neither a single system is left at the bottom of a page (orphan) nor a single
 * one lands alone at the top of the next (widow):
 *  - the first system is placed with the second; a line of up to three systems stays together
 *    (a break would leave one alone);
 *  - the last two systems stay together.
 */
export function systemsToKeep(k: number, n: number): number {
  if (n <= 1) return 1;
  if (k === 0) return n <= 3 ? n : 2;
  return k === n - 2 ? 2 : 1;
}
