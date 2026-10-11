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
