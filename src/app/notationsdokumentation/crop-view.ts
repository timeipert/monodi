/**
 * A piece of a manuscript page as the notation documentation shows it in the browser: the picture
 * (a IIIF crop, or the whole image shown through a box of the crop's shape) and outlines laid over
 * it, in percent of the piece. Pure functions; the component that draws it is `nd-crop`.
 */

import { backgroundStyle, boundsOf, cropAspect, imageCropUrlByWidth, Rect, toCropSpace } from '../iiif-crop';
import { PageImage } from './region-page';

/** An outline over the picture, with the label written above it. */
export interface CropMark {
  id: string;
  /** In percent of the piece. */
  points: string;
  label: string;
  /** Where the label stands: the outline's top left corner, in percent of the piece. */
  x: number;
  y: number;
  /** The one the piece is about (drawn stronger). */
  strong: boolean;
}

export interface CropView {
  /** A IIIF crop. */
  url?: string;
  /** Otherwise the whole image, through a box of the crop's own shape. */
  background?: { image: string; size: string; position: string };
  /** Width : height, if it can be known before the picture is there. */
  aspect: number | null;
  marks: CropMark[];
}

/**
 * The view of `rect` (page percent) of a page, with outlines (page percent) over it. Null if the page has no
 * picture to show.
 */
export function cropView(
  page: PageImage | null,
  rect: Rect,
  maxW: number,
  outlines: { id: string; points: string; label?: string; strong?: boolean }[] = []
): CropView | null {
  if (!page || !(rect.w > 0) || !(rect.h > 0)) return null;
  const marks = outlines.map(o => {
    const b = boundsOf(o.points);
    return {
      id: o.id, points: toCropSpace(o.points, rect), label: o.label ?? '', strong: !!o.strong,
      x: b ? ((b.x - rect.x) / rect.w) * 100 : 0, y: b ? ((b.y - rect.y) / rect.h) * 100 : 0,
    };
  });
  const aspect = page.w && page.h ? cropAspect(rect, page.w, page.h) : null;
  if (page.base) return { url: imageCropUrlByWidth(page.base, rect, maxW, page.w), aspect, marks };
  if (page.url) return { background: { image: page.url, ...backgroundStyle(rect) }, aspect: aspect ?? cropAspect(rect), marks };
  return null;
}
