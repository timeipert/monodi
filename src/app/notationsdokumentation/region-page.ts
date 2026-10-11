/**
 * Which IIIF canvas does an annotation region belong to?
 *
 * Two apps write `AnnotationRegion`s into the same repository and used to mean
 * different things by `folio`: Monodi stored the canvas *index* ("7"), the
 * Neume Viewer a folio *label* ("113r"). A region now says where it is in up to
 * three ways, and readers try them in this order:
 *
 *   1. `canvasId`    the IIIF canvas id: exact, survives a reordered manifest
 *   2. `imageId`     the IIIF Image API base of the page image
 *   3. `folioLabel`  the page label as the writer knew it ("113r")
 *   4. `folio`       legacy: a canvas index if it is all digits, else a label
 *
 * Pure functions on plain data, so the same rules can be tested in isolation.
 * See INTEGRATION-PLAN.md §4.1.
 */

import * as VM from '../types/model';

type PageFields = Pick<VM.AnnotationRegion, 'folio' | 'canvasId' | 'folioLabel' | 'imageId'>;

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** IIIF Presentation 2 uses `@id`, 3 uses `id`. */
export function canvasIdOf(canvas: any): string | undefined {
  const id = canvas?.['@id'] ?? canvas?.id;
  return typeof id === 'string' && id ? id : undefined;
}

/** The IIIF Image API base of a canvas' image (v2 `resource.service`, v3 `body.service`), without a trailing slash. */
export function canvasImageIdOf(canvas: any): string | undefined {
  const first = (v: any) => (Array.isArray(v) ? v[0] : v);
  const v2 = first(canvas?.images?.[0]?.resource?.service);
  const v3 = first(canvas?.items?.[0]?.items?.[0]?.body?.service);
  const id = v2?.['@id'] ?? v2?.id ?? v3?.id ?? v3?.['@id'];
  return typeof id === 'string' && id ? trimSlash(id) : undefined;
}

/** A canvas label as plain text: a string (v2), a language map (v3) or a v2 value list. */
export function canvasLabelOf(canvas: any): string {
  const label = canvas?.label;
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) return canvasLabelOf({ label: label[0] });
  if (label && typeof label === 'object') {
    if (typeof label['@value'] === 'string') return label['@value'];
    const first = Object.values(label)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
  }
  return '';
}

/**
 * Canonical form of a folio string for comparison:
 *   "fol. 1r", "f. 1r", "Bl. 1r", "folio 1r" → "1r"
 *   "1 recto" → "1r", "1 verso" → "1v"
 */
export function normalizeFolio(raw: string): string {
  return String(raw)
    .toLowerCase()
    .replace(/\b(fol|folio|bl|blatt|page|pg|leaf)\b\.?\s*/g, '')
    .replace(/\brecto\b/g, 'r')
    .replace(/\bverso\b/g, 'v')
    .replace(/[^a-z0-9]/g, '');
}

/** True when two folio strings name the same leaf side; a bare number counts as recto ("1" ~ "1r"). */
export function folioMatches(a: string, b: string): boolean {
  const na = normalizeFolio(a);
  const nb = normalizeFolio(b);
  if (na === nb) return true;
  if (/^\d+$/.test(na) && na + 'r' === nb) return true;
  if (/^\d+$/.test(nb) && nb + 'r' === na) return true;
  return false;
}

interface CanvasLookup {
  byId: Map<string, number>;
  byImage: Map<string, number>;
  byLabel: Map<string, number>;
}

// The getters that call us run on every change-detection pass (mouse moves
// included), so the lookup is built once per canvas list, not once per call.
const lookups = new WeakMap<any[], CanvasLookup>();

function lookupFor(canvases: any[]): CanvasLookup {
  let l = lookups.get(canvases);
  if (!l) {
    l = { byId: new Map(), byImage: new Map(), byLabel: new Map() };
    canvases.forEach((c, i) => {
      const id = canvasIdOf(c);
      if (id !== undefined && !l!.byId.has(id)) l!.byId.set(id, i);
      const image = canvasImageIdOf(c);
      if (image !== undefined && !l!.byImage.has(image)) l!.byImage.set(image, i);
      const label = normalizeFolio(canvasLabelOf(c));
      if (label && !l!.byLabel.has(label)) l!.byLabel.set(label, i);
    });
    lookups.set(canvases, l);
  }
  return l;
}

function indexOfLabel(l: CanvasLookup, label: string): number | undefined {
  const n = normalizeFolio(label);
  if (!n) return undefined;
  const exact = l.byLabel.get(n);
  if (exact !== undefined) return exact;
  // bare number ↔ explicit recto, as in folioMatches
  if (/^\d+$/.test(n)) return l.byLabel.get(n + 'r');
  const bare = /^(\d+)r$/.exec(n);
  return bare ? l.byLabel.get(bare[1]) : undefined;
}

/** The canvas index a region sits on, or null if it cannot be placed in this manifest. */
export function regionCanvasIndex(region: PageFields, canvases: any[]): number | null {
  if (!canvases.length) return null;
  const l = lookupFor(canvases);

  if (region.canvasId) {
    const i = l.byId.get(region.canvasId);
    if (i !== undefined) return i;
  }
  if (region.imageId) {
    const i = l.byImage.get(trimSlash(region.imageId));
    if (i !== undefined) return i;
  }
  if (region.folioLabel) {
    const i = indexOfLabel(l, region.folioLabel);
    if (i !== undefined) return i;
  }
  const folio = (region.folio ?? '').trim();
  if (/^\d+$/.test(folio)) {
    const n = Number(folio);
    return n < canvases.length ? n : null;
  }
  if (folio) {
    const i = indexOfLabel(l, folio);
    if (i !== undefined) return i;
  }
  return null;
}

/** True when the region is on the canvas at `index`. */
export function regionOnCanvas(region: PageFields, canvases: any[], index: number): boolean {
  // Fast path for regions this app stamped: no lookup needed.
  if (region.canvasId && canvasIdOf(canvases[index]) === region.canvasId) return true;
  return regionCanvasIndex(region, canvases) === index;
}

/** Record where a region is: the legacy index plus the canvas id and label, so other apps can place it. */
export function stampRegionPage(region: PageFields, canvases: any[], index: number): void {
  region.folio = String(index);
  const canvas = canvases[index];
  const id = canvasIdOf(canvas);
  if (id) region.canvasId = id;
  const label = canvasLabelOf(canvas);
  if (label) region.folioLabel = label;
}

/**
 * Give regions written without a canvas id (older data, or the Neume Viewer
 * before it sends one) their canvas id, and a label if they have none. Existing
 * `folio` and `folioLabel` values are never rewritten: another app may key on
 * them. Regions that cannot be placed are left alone. Returns how many changed.
 */
export function backfillRegionPages(regions: PageFields[], canvases: any[]): number {
  let changed = 0;
  for (const r of regions) {
    if (r.canvasId) continue;
    const i = regionCanvasIndex(r, canvases);
    if (i === null) continue;
    const id = canvasIdOf(canvases[i]);
    if (!id) continue;
    r.canvasId = id;
    if (!r.folioLabel) {
      const label = canvasLabelOf(canvases[i]);
      if (label) r.folioLabel = label;
    }
    changed++;
  }
  return changed;
}

/** What is needed to cut a region out of its page. */
export interface PageImage {
  /** IIIF Image API base: crops can be requested from the server. */
  base?: string;
  /** The whole image, for when there is no image service. */
  url?: string;
  /** Page size in pixels, if the manifest says (the shape of a percent crop depends on it). */
  w?: number;
  h?: number;
}

function canvasImageUrlOf(canvas: any): string | undefined {
  const v2 = canvas?.images?.[0]?.resource;
  const v3 = canvas?.items?.[0]?.items?.[0]?.body;
  const url = v2?.['@id'] ?? v2?.id ?? v3?.id;
  return typeof url === 'string' && url ? url : undefined;
}

/**
 * The page image a region sits on: its own `imageId` if it has one (that works with
 * no manifest at all), else the image of the canvas it resolves to.
 */
export function pageImageOf(region: PageFields, canvases: any[]): PageImage | null {
  const i = regionCanvasIndex(region, canvases);
  const canvas = i === null ? undefined : canvases[i];
  const w = Number(canvas?.width) || undefined;
  const h = Number(canvas?.height) || undefined;
  if (region.imageId) return { base: trimSlash(region.imageId), w, h };
  if (!canvas) return null;
  const base = canvasImageIdOf(canvas);
  const url = canvasImageUrlOf(canvas);
  return base || url ? { base, url, w, h } : null;
}

/** A page label a person can read: the label the writer knew, else the manifest's, else "page N". */
export function pageLabelOf(region: PageFields, canvases: any[]): string {
  if (region.folioLabel) return region.folioLabel;
  const i = regionCanvasIndex(region, canvases);
  if (i !== null) return canvasLabelOf(canvases[i]) || `page ${i + 1}`;
  const folio = (region.folio ?? '').trim();
  return folio && !/^\d+$/.test(folio) ? folio : '';
}
