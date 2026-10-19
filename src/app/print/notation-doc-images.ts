import * as VM from '../types/model';
import { imageCropUrl, imageCropUrlByWidth, padRect, Rect } from '../iiif-crop';
import { pageImageOf } from '../notationsdokumentation/region-page';
import { NotationStrip } from '../notation-doc';
import { loadImage, toGreyLevels } from './image-loader';
import { StripPicture } from './notation-doc-draw';

/** How a strip is cut from its page: a little more than the line, so that signs above the staff show. */
export const STRIP_PAD_X = 0.01;
export const STRIP_PAD_Y = 0.12;
const STRIP_MAX_W = 1800;
const STRIP_MAX_H = 520;
const PARALLEL = 2;
/** Waits (ms) before the second and third try of an image: a library that rate-limits answers a burst with an error that looks like a CORS failure. */
const RETRY_WAITS = [900, 2500];
const TIMEOUT_MS = 25000;

async function fetchJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The canvases of a IIIF manifest (Presentation 2 or 3). */
export async function manifestCanvases(url: string): Promise<any[]> {
  const manifest = await fetchJson(url);
  return manifest?.sequences?.[0]?.canvases ?? manifest?.items ?? [];
}

/**
 * The pictures of a manuscript's strips: each line cut from its page at the IIIF server. A strip
 * that cannot be shown (no manifest, the page is not in it, the server refuses) gets a reason
 * instead, so the table and the other strips are still printed.
 */
export async function loadStripPictures(
  strips: NotationStrip[],
  manifestUrl: string | undefined,
  onProgress?: (done: number, total: number) => void,
  /** Pictures kept for lines that are not cut from a page (`notation-strip-images.ts`), by region id. */
  localImages: { [regionId: string]: string } = {}
): Promise<{ pictures: Map<string, StripPicture>; problems: string[] }> {
  const pictures = new Map<string, StripPicture>();
  const problems: string[] = [];
  let canvases: any[] = [];
  let manifestProblem = '';
  // a manifest is only needed by a strip that is cut from a page
  const needsManifest = strips.some(s => !localImages[s.region.id] && !(s.region as VM.AnnotationRegion).imageId);
  if (manifestUrl && needsManifest) {
    try { canvases = await manifestCanvases(manifestUrl); }
    catch (e: any) { manifestProblem = `The manifest could not be read (${e?.name === 'AbortError' ? 'timeout' : e?.message || 'network error'}); the library may not let other websites read it.`; }
  } else if (!manifestUrl) {
    manifestProblem = 'This manuscript has no IIIF manifest.';
  }

  let done = 0;
  const one = async (s: NotationStrip): Promise<void> => {
    const crop = padRect(s.rect, STRIP_PAD_X, STRIP_PAD_Y);
    const fail = (problem: string) => { pictures.set(s.region.id, { image: null, crop, problem }); };
    try {
      const kept = localImages[s.region.id];
      if (kept) {
        // the picture is the line itself: its snippets are given in percent of it
        const whole: Rect = { x: 0, y: 0, w: 100, h: 100 };
        const image = await loadImage(kept, STRIP_MAX_W);
        if (!image) return fail('The picture kept for this line cannot be read.');
        pictures.set(s.region.id, { image: await toGreyLevels(image), crop: whole });
        return;
      }
      const page = pageImageOf(s.region as VM.AnnotationRegion, canvases);
      if (!page?.base) return fail(manifestProblem || (page ? 'The page has no image service.' : `${s.place.folio || 'The page'} is not in the manifest.`));
      // by width first (every server knows it), then best-fit (a server that does not size by width alone)
      const byWidth = imageCropUrlByWidth(page.base, crop, STRIP_MAX_W, page.w);
      let image = await loadImage(byWidth, STRIP_MAX_W);
      for (const wait of RETRY_WAITS) {
        if (image) break;
        await new Promise((r) => setTimeout(r, wait));
        image = await loadImage(byWidth, STRIP_MAX_W);
      }
      image ??= await loadImage(imageCropUrl(page.base, crop, STRIP_MAX_W, STRIP_MAX_H), STRIP_MAX_W);
      if (!image) return fail('The image could not be loaded; the library may not let other websites use its images, or limits how many are asked for.');
      pictures.set(s.region.id, { image: await toGreyLevels(image), crop });
    } catch (e: any) {
      fail(e?.message || 'The image could not be loaded.');
    } finally {
      onProgress?.(++done, strips.length);
    }
  };

  // a few at a time: a server asked for fifty crops at once may refuse some
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, strips.length) }, async () => {
    while (next < strips.length) await one(strips[next++]);
  }));

  const failed = strips.filter(s => !pictures.get(s.region.id)?.image);
  if (failed.length) {
    const reasons = new Set(failed.map(s => pictures.get(s.region.id)?.problem).filter(Boolean));
    problems.push(`${failed.length} of ${strips.length} strips without image: ${[...reasons].slice(0, 2).join(' ')}`);
  }
  return { pictures, problems };
}
