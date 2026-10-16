import type { jsPDF } from 'jspdf';
import { PlaceholderLookup } from './placeholders';
import { CoverLayout, TitleStyle, TitleTemplate, layoutCover } from './title-page';

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sets the cover on the current page of `doc`, in the font the rest of the print uses. */
export function drawCover(doc: jsPDF, template: TitleTemplate, lookup: PlaceholderLookup, fontFamily: string): CoverLayout {
  const page = { w: doc.internal.pageSize.getWidth(), h: doc.internal.pageSize.getHeight() };
  const font = (style: TitleStyle, size: number) => { doc.setFont(fontFamily, style); doc.setFontSize(size); };
  const layout = layoutCover(template, lookup, page, (text, size, style) => { font(style, size); return doc.getTextWidth(text); });
  for (const item of layout.items) {
    if (item.kind === 'rule') {
      doc.setDrawColor(...rgb(item.color));
      doc.setLineWidth(item.thickness);
      doc.line(item.x1, item.y, item.x2, item.y);
    } else {
      font(item.style, item.size);
      doc.setTextColor(...rgb(item.color));
      doc.text(item.text, item.x, item.y, { align: item.align });
    }
  }
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  return layout;
}
