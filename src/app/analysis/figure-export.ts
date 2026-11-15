/**
 * Turns the SVG of a figure (see `renderViewSvg` in `@monodi/core/analysis`) into a file: an SVG as it is, a PNG at a chosen
 * resolution, or a PDF with vector graphics whose page is exactly the figure. Neither raster nor PDF gets a background, so
 * the figure can be placed on a coloured page or a slide.
 *
 * Units: the SVG is drawn in points, so a figure 175 mm wide is 496 pt wide and the PDF page has that size.
 */

/** The SVG text as a file. */
export function svgToBlob(svg: string): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`], { type: 'image/svg+xml;charset=utf-8' });
}

/** The pixel size of a PNG of a figure `width` pt wide at `dpi` dots per inch (capped so a canvas stays within browser limits). */
export function pngSize(width: number, height: number, dpi: number): { w: number; h: number; scale: number } {
  const wanted = dpi / 72;
  const cap = 16000 / Math.max(width, height, 1);
  const scale = Math.min(wanted, cap);
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)), scale };
}

/** A PNG with a transparent background (nothing is painted behind the drawing). */
export async function svgToPng(svg: string, width: number, height: number, dpi = 300): Promise<Blob> {
  const { w, h } = pngSize(width, height, dpi);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.width = w;
  img.height = h;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The browser could not draw the figure.'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The browser has no canvas to draw the figure on.');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be made.'))), 'image/png'));
}

/** A one-page PDF of the size of the figure with vector graphics and text (set in Helvetica) and no background. */
export async function svgToPdf(svg: string, width: number, height: number): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ unit: 'pt', format: [width, height], orientation: width > height ? 'landscape' : 'portrait', compress: true });
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  // svg2pdf reads computed styles, so the element must be part of a document while it is drawn.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden';
  holder.appendChild(document.importNode(parsed, true));
  document.body.appendChild(holder);
  try {
    await doc.svg(holder.firstElementChild as Element, { x: 0, y: 0, width, height });
  } finally {
    holder.remove();
  }
  return doc.output('blob');
}
