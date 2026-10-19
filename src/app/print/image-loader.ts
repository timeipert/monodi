/** A picture ready for the PDF (and the editor): a PNG or JPEG data URL with its size in pixels. */
export interface LoadedImage { data: string; format: 'JPEG' | 'PNG'; w: number; h: number }

/**
 * Decodes a picture from a Blob and re-encodes it at no more than `maxPx` on its long side:
 * transparent formats (PNG, GIF, WebP, SVG) as PNG, photographs as JPEG. Browser only.
 */
export async function rasterize(blob: Blob, maxPx: number, quality = 0.88): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('The picture cannot be read')); });
    let w = img.naturalWidth || 300;
    let h = img.naturalHeight || 150;      // an SVG without size
    const k = Math.min(1, maxPx / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const png = /png|gif|webp|svg/i.test(blob.type);
    if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', quality), format: png ? 'PNG' : 'JPEG', w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A picture from an address or a data URL; null if it cannot be fetched (offline, no CORS …). */
export async function loadImage(src: string, maxPx = 1600): Promise<LoadedImage | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await rasterize(await res.blob(), maxPx);
  } catch {
    return null;
  }
}

/**
 * A photograph as the printed volume shows manuscript pages: grey, dark ink on a light ground, with the
 * levels stretched a little (the darkest and lightest 0.5 % become black and white). Some archives
 * publish their scans as negatives (light ink on a dark ground). The ink is the small part of a page, so
 * it is the tail of the tones that reaches furthest from the middle: if that is the light tail, the
 * picture is a negative and is inverted. Browser only; returns the picture unchanged if it cannot be decoded.
 */
export async function toGreyLevels(img: LoadedImage, clip = 0.005): Promise<LoadedImage> {
  try {
    const el = new Image();
    el.src = img.data;
    await new Promise<void>((res, rej) => { el.onload = () => res(); el.onerror = () => rej(new Error('decode')); });
    const canvas = document.createElement('canvas');
    canvas.width = img.w;
    canvas.height = img.h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(el, 0, 0, img.w, img.h);
    const px = ctx.getImageData(0, 0, img.w, img.h);
    const d = px.data;
    const total = d.length / 4;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = g;
      hist[g]++;
    }
    const percentile = (q: number): number => {
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * q) return v; }
      return 255;
    };
    const median = percentile(0.5);
    const negative = percentile(0.95) - median > (median - percentile(0.05)) * NEGATIVE_TAIL;
    let acc = 0;
    const level = (v: number) => (negative ? 255 - v : v);
    const h2 = new Uint32Array(256);
    for (let v = 0; v < 256; v++) h2[level(v)] += hist[v];
    let lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += h2[v]; if (acc >= total * clip) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += h2[v]; if (acc >= total * clip) { hi = v; break; } }
    if (hi - lo < 16) { lo = 0; hi = 255; }   // an even picture: nothing to stretch
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.min(255, Math.max(0, Math.round((level(d[i]) - lo) * k)));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(px, 0, 0);
    return { data: canvas.toDataURL('image/jpeg', 0.85), format: 'JPEG', w: img.w, h: img.h };
  } catch {
    return img;
  }
}

/** The light tail of a negative is this much longer than its dark tail. */
const NEGATIVE_TAIL = 1.3;
