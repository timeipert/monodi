/**
 * Cutting a piece out of a manuscript page.
 *
 * Regions and snippets are polygons in percent of the page image (0–100 on both
 * axes), so a crop needs no knowledge of the image's pixel size: the IIIF Image
 * API takes a region as `pct:x,y,w,h`. Pure functions, no DOM.
 */

/** A rectangle in percent of the page. */
export interface Rect { x: number; y: number; w: number; h: number; }

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Bounding box of a `"x,y x,y …"` polygon, or null if it has no area. */
export function boundsOf(points: string | undefined): Rect | null {
  if (!points) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points.split(/\s+/)) {
    if (!p) continue;
    const [x, y] = p.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The rectangle grown by a fraction of its size on each side (so the sign is seen
 * among its neighbours), at least `minW`/`minH` percent in total, kept on the page.
 */
export function padRect(r: Rect, fx: number, fy: number, minW = 0, minH = 0): Rect {
  let w = Math.max(r.w * (1 + 2 * fx), minW);
  let h = Math.max(r.h * (1 + 2 * fy), minH);
  w = Math.min(w, 100);
  h = Math.min(h, 100);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), 100 - w);
  const y = Math.min(Math.max(cy - h / 2, 0), 100 - h);
  return { x, y, w, h };
}

/** IIIF Image API request for the rectangle, fitted into a box of at most `maxW` × `maxH` pixels. */
export function imageCropUrl(imageBase: string, r: Rect, maxW = 900, maxH = 360): string {
  const base = imageBase.replace(/\/+$/, '');
  return `${base}/pct:${num(r.x)},${num(r.y)},${num(r.w)},${num(r.h)}/!${maxW},${maxH}/0/default.jpg`;
}

/** A polygon given in page percent, re-expressed in percent of the crop (so it can be laid over it). */
export function toCropSpace(points: string | undefined, crop: Rect): string {
  if (!points) return '';
  return points.split(/\s+/).filter(Boolean).map(p => {
    const [x, y] = p.split(',').map(Number);
    return `${num(((x - crop.x) / crop.w) * 100)},${num(((y - crop.y) / crop.h) * 100)}`;
  }).join(' ');
}

/**
 * Width : height of the crop as it will look, from the page's pixel size when it
 * is known (the percent rectangle is not square on a portrait page), else a
 * typical page.
 */
export function cropAspect(r: Rect, pageW?: number, pageH?: number): number {
  const W = pageW && pageW > 0 ? pageW : 3;
  const H = pageH && pageH > 0 ? pageH : 4;
  return (r.w * W) / (r.h * H);
}

/**
 * CSS to show the rectangle of a whole-page image in a box of the crop's own
 * shape, for pages that have no IIIF image service to cut it for us.
 */
export function backgroundStyle(r: Rect): { size: string; position: string } {
  const pos = (offset: number, size: number) => (size >= 100 ? 0 : (offset / (100 - size)) * 100);
  return {
    size: `${num(10000 / r.w)}% ${num(10000 / r.h)}%`,
    position: `${num(pos(r.x, r.w))}% ${num(pos(r.y, r.h))}%`
  };
}
