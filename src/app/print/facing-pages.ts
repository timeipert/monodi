import type { jsPDF } from 'jspdf';

/**
 * Sets the pages of a finished document like the facing pages of a printed volume: the odd pages (PDF page 1 is the
 * right-hand one) stay as they are, every even page is moved sideways by `dx` pt, content and link areas alike.
 * The first page (the cover) stays where it is.
 */
export function shiftVersoPages(doc: jsPDF, dx: number, totalPages: number): void {
  if (!dx) return;
  const internal: any = doc.internal;
  for (let n = 2; n <= totalPages; n += 2) {
    const page: string[] | undefined = internal.pages?.[n];
    if (!page) continue;
    // the content is drawn in the page's own units (pt); the matrix moves everything in it
    page.unshift(`q 1 0 0 1 ${dx.toFixed(3)} 0 cm`);
    page.push('Q');
    const annotations: any[] = internal.getPageInfo(n)?.pageContext?.annotations ?? [];
    for (const a of annotations) {
      const b = a.finalBounds;
      if (!b) continue;
      b.x = (parseFloat(b.x) + dx).toFixed(2);
      b.w = (parseFloat(b.w) + dx).toFixed(2);
    }
  }
}
