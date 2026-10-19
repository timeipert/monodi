/**
 * Documentations published by the Neumen-Editor (repository cm-neumen-editor, "Reading and publishing
 * documentations"): `neume-docs.json` and, for every manuscript, one file in `data/`. Pictures that are
 * kept as files lie in `images/`.
 *
 *   neume-docs.json   { format: 'neume-docs', version: 1, info, columns, signs, manuscripts: [
 *                       { id, source, name, kind: 'iiif' | 'collection', meta, file: 'data/X.json' } ] }
 *   data/X.json       { id, source, name, notes, kind,
 *                       rows:     [{ pattern, refId, notes, tier }],
 *                       snippets: [{ id, pattern, variant, refId, folio, line, image, lineId }],
 *                       lines:    [{ id, folio, name, image, items: [{ id, points | box }] }] }
 *
 * The documentation holds no page coordinates and no manifest, only what a reader of the web shows. A
 * line is known by its picture, and that tells how it is placed:
 *
 *  - a IIIF crop (`<image service>/pct:x,y,w,h/1200,/0/default.jpg`, what the editor writes for a manuscript
 *    on IIIF): the address names the page image and the part of the page, so the line becomes a region on
 *    that page (`imageId`), and its snippets, which are given in percent of the line, are put back on the
 *    page. The region is the (slightly padded) rectangle round the line, not its original polygon;
 *  - a picture that is a file of the documentation (screenshots): the line is the whole picture, its snippets
 *    are boxes on it, and the picture travels with the file (`regionImages`) to be kept on this computer;
 *  - anything else cannot be printed: the line is left out, and the preview says so.
 *
 * Everything is converted to the annotation exchange file, so the one preview and the one merge in
 * `annotation-exchange.ts` serve it too. What is read from a documentation is untrusted: it is cleaned here.
 * The first half is pure functions on plain data; the second half reads the files a person chose.
 */

import * as JSZip from 'jszip';
import * as VM from './types/model';
import { EXCHANGE_FORMAT, EXCHANGE_VERSION, ExchangeFile, ExchangeSource } from './annotation-exchange';

export const NEUME_DOCS_FORMAT = 'neume-docs';
export const NEUME_DOCS_INDEX = 'neume-docs.json';
/** The newest version of the format this reader knows. */
const KNOWN_VERSION = 1;

const MAX_MANUSCRIPTS = 5000;
const MAX_SNIPPETS = 30000;
/** A picture larger than this (bytes) is not read into the file. */
const MAX_PICTURE_BYTES = 6_000_000;

/** A documentation with its manuscript files (and pictures) put into it: what `convertNeumeDocs` reads. */
export interface NeumeDocsBundle {
  format: typeof NEUME_DOCS_FORMAT;
  version: number;
  manuscripts: { id?: string; source?: string; name?: string; kind?: string; file?: string; data?: any }[];
  /** Pictures of the documentation by their path in it, as image data URLs. */
  files?: { [path: string]: string };
  [other: string]: any;
}

/** True for the index of a documentation (with or without its manuscripts). */
export function isNeumeDocs(data: any): boolean {
  return !!data && typeof data === 'object' && !Array.isArray(data) && data.format === NEUME_DOCS_FORMAT;
}

const plain = (v: unknown): v is { [key: string]: any } => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 300): string =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const round = (n: number): number => Math.round(n * 1000) / 1000;
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);

/** Letters of a pattern code that mark a special sign of the editor's (a virga `V`), not a note: not L Q O S A D, which have a meaning of their own. */
const SIGN_KEYS = /[BCE-KMNPRT-Z]/g;

/** The picture's address in IIIF terms: `<service>/pct:x,y,w,h/<size>/<rotation>/<quality>.<format>`. */
const IIIF_CROP = /^(https?:\/\/.+)\/pct:(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)\/[^/]+\/[^/]+\/[^/]+$/i;
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i;

interface PageRect { x: number; y: number; w: number; h: number }

/** Where on which page a IIIF crop address cuts, or null if the address is not one. */
export function parseIiifCrop(url: string): { imageId: string; rect: PageRect } | null {
  const m = IIIF_CROP.exec(url.trim());
  if (!m) return null;
  const [x, y, w, h] = [m[2], m[3], m[4], m[5]].map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const cx = Math.min(Math.max(x, 0), 100), cy = Math.min(Math.max(y, 0), 100);
  const rect = { x: cx, y: cy, w: Math.min(w, 100 - cx), h: Math.min(h, 100 - cy) };
  if (rect.w <= 0 || rect.h <= 0) return null;
  return { imageId: m[1].replace(/\/+$/, ''), rect };
}

const rectPoints = (r: PageRect): string =>
  `${round(r.x)},${round(r.y)} ${round(r.x + r.w)},${round(r.y)} ${round(r.x + r.w)},${round(r.y + r.h)} ${round(r.x)},${round(r.y + r.h)}`;

/** The vertices of a "x,y x,y …" string; null if one is not a pair of numbers. */
function vertices(points: unknown): [number, number][] | null {
  if (typeof points !== 'string' || points.length > 3000) return null;
  const out: [number, number][] = [];
  for (const p of points.split(/\s+/)) {
    if (!p) continue;
    const [x, y] = p.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([x, y]);
  }
  return out.length >= 3 ? out : null;
}

/** A snippet's outline in percent of its line: its polygon, else its box. */
function outlineOf(item: any): [number, number][] | null {
  const poly = vertices(item?.points);
  if (poly) return poly;
  const b = item?.box;
  if (plain(b)) {
    const [x, y, w, h] = [num(b.x), num(b.y), num(b.w), num(b.h)];
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  return null;
}

const clamp100 = (n: number): number => Math.min(100, Math.max(0, n));

export function convertNeumeDocs(bundle: any): ExchangeFile {
  if (!isNeumeDocs(bundle)) throw new Error('This is not a documentation of the Neumen-Editor.');
  if (typeof bundle.version !== 'number' || bundle.version < 1) {
    throw new Error('This documentation does not say which version of the format it uses.');
  }
  if (bundle.version > KNOWN_VERSION) {
    throw new Error('This documentation was written by a newer version of the Neumen-Editor. Update Monodi-Zero to read it.');
  }
  const entries: any[] = (Array.isArray(bundle.manuscripts) ? bundle.manuscripts : []).filter(plain).slice(0, MAX_MANUSCRIPTS);
  if (entries.length && !entries.some(e => plain(e.data))) {
    throw new Error('This is the index of a documentation (neume-docs.json). Choose it together with the files of its folder data/, or choose the ZIP that the Neumen-Editor makes.');
  }
  const files: { [path: string]: string } = plain(bundle.files) ? bundle.files : {};

  const sources: ExchangeSource[] = [];
  const warnings: string[] = [];
  const empty: string[] = [];
  const missing: string[] = [];
  for (const entry of entries) {
    const data = entry.data;
    const name = text(entry.source, 120) || text(data?.source, 120) || text(entry.id, 120);
    if (!plain(data)) { missing.push(text(entry.file) || name); continue; }
    if (!name) continue;
    const { source, left } = convertManuscript(name, data, files);
    if (left) warnings.push(`${name}: ${left} line${left === 1 ? '' : 's'} left out (no IIIF address and no picture among the files).`);
    if (!source) { empty.push(name); continue; }
    sources.push(source);
  }
  if (missing.length) {
    warnings.push(`${missing.length} manuscript file${missing.length === 1 ? ' is' : 's are'} not among the files chosen: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}.`);
  }
  if (empty.length) {
    warnings.push(`${empty.length} manuscript${empty.length === 1 ? ' has' : 's have'} neither Reference IDs nor marked lines, so there is nothing to import: ${empty.slice(0, 3).join(', ')}${empty.length > 3 ? ', …' : ''}.`);
  }
  return {
    format: EXCHANGE_FORMAT, version: EXCHANGE_VERSION, generator: 'Neumen-Editor (documentation)',
    exportedAt: text(bundle.generated, 40) || undefined, sources, ...(warnings.length ? { warnings } : {})
  };
}

/** One manuscript's file as a source of the exchange file; `source` is null if it holds nothing to import. */
function convertManuscript(name: string, data: any, files: { [path: string]: string }): { source: ExchangeSource | null; left: number } {
  const collection = data.kind === 'collection';

  // --- the table: Reference ID per pattern; the first row of a pattern wins ---
  const table = new Map<string, { refId: string; notes: string }>();
  for (const row of Array.isArray(data.rows) ? data.rows : []) {
    const pattern = text(row?.pattern, 120), refId = text(row?.refId, 60);
    if (pattern && refId && !table.has(pattern)) table.set(pattern, { refId, notes: text(row.notes, 1000) });
  }

  const snippets = new Map<string, any>();
  for (const s of (Array.isArray(data.snippets) ? data.snippets : []).slice(0, MAX_SNIPPETS)) {
    const id = text(s?.id, 160);
    if (id && text(s.pattern, 120) && !snippets.has(id)) snippets.set(id, s);
  }

  // the pattern as the table knows it: a code with a special sign (`*V`) is called by the row of the code without it
  const tableKey = (pattern: string): string => {
    if (table.has(pattern)) return pattern;
    const bare = pattern.replace(SIGN_KEYS, '');
    return bare !== pattern && table.has(bare) ? bare : pattern;
  };

  const regions: VM.AnnotationRegion[] = [];
  const items: VM.AnnotationItem[] = [];
  const regionImages: { [regionId: string]: string } = {};
  const seenRegions = new Set<string>();
  const seenItems = new Set<string>();
  let left = 0;

  for (const line of Array.isArray(data.lines) ? data.lines : []) {
    const id = text(line?.id, 160);
    if (!id || seenRegions.has(id)) continue;
    const entries = (Array.isArray(line.items) ? line.items : [])
      .map((it: any) => ({ it, snippet: snippets.get(text(it?.id, 160)), outline: outlineOf(it) }))
      .filter((e: any) => e.snippet && e.outline && !seenItems.has(text(e.it.id, 160)));
    if (!entries.length) continue;   // a line without a marked sign documents nothing

    // --- where the line is ---
    const image = typeof line.image === 'string' ? line.image.trim() : '';
    const crop = image ? parseIiifCrop(image) : null;
    let picture = '';
    if (!crop && image) {
      const found = IMAGE_DATA_URL.test(image) ? image : files[image];
      if (found && IMAGE_DATA_URL.test(found)) picture = found;
    }
    if (!crop && !picture) { left++; continue; }

    const folio = text(line.folio, 40) || text(entries[0].snippet.folio, 40);
    const lineName = text(line.name, 80) || text(entries[0].snippet.line, 80);
    const region: VM.AnnotationRegion = {
      id, name: lineName, folio: '',
      points: crop ? rectPoints(crop.rect) : '0,0 100,0 100,100 0,100'
    };
    if (folio) region.folioLabel = folio;
    if (crop) region.imageId = crop.imageId;
    else regionImages[id] = picture;
    seenRegions.add(id);
    regions.push(region);

    for (const { it, snippet, outline } of entries) {
      const itemId = text(it.id, 160);
      if (seenItems.has(itemId)) continue;
      seenItems.add(itemId);
      // the outline is in percent of the line: on a IIIF page it goes back to percent of the page
      const points = (outline as [number, number][])
        .map(([x, y]) => crop
          ? `${round(crop.rect.x + (clamp100(x) * crop.rect.w) / 100)},${round(crop.rect.y + (clamp100(y) * crop.rect.h) / 100)}`
          : `${round(clamp100(x))},${round(clamp100(y))}`)
        .join(' ');
      const pattern = tableKey(text(snippet.pattern, 120));
      // a collection of screenshots keeps the Reference ID on the snippet, not in the table
      const own = text(snippet.refId, 60);
      if (collection && !table.has(pattern) && own && own !== '-') table.set(pattern, { refId: own, notes: '' });
      const item: VM.AnnotationItem = { id: itemId, regionId: id, pattern, points };
      const variant = text(snippet.variant, 20);
      if (variant) item.variant = variant;
      items.push(item);
    }
  }

  const equivalents: VM.EquivalentMetadata[] = [...table].map(([pattern, v]) => {
    const row: VM.EquivalentMetadata = { pattern, refId: v.refId };
    if (v.notes) row.notes = v.notes;
    return row;
  });
  if (!equivalents.length && !regions.length) return { source: null, left };

  const source: ExchangeSource = { quellensigle: name, equivalents, annotationRegions: regions, annotationItems: items };
  const notes = text(data.notes, 5000);
  if (notes) source.notationNotes = notes;
  if (Object.keys(regionImages).length) source.regionImages = regionImages;
  return { source, left };
}

// ── Reading what a person chose ─────────────────────────────────────────────────────────────────
// The editor offers a documentation as a ZIP (neume-docs.json, data/, images/); it lies in a GitHub
// repository as the same folder. A person can choose the ZIP, or neume-docs.json together with the files
// of data/ (and images/, for screenshots), in one go.

/** A place to look files up by their path in the documentation. */
interface FileSource {
  /** The text of the file at `path` (relative to the index), or undefined. */
  text(path: string): Promise<string | undefined>;
  /** The picture at `path` as a data URL, or undefined. */
  picture(path: string): Promise<string | undefined>;
}

const MIME: { [ext: string]: string } = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
const extOf = (path: string): string => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Puts the manuscript files and the pictures its lines point to into the index. */
async function assemble(index: any, from: FileSource): Promise<NeumeDocsBundle> {
  const files: { [path: string]: string } = {};
  const manuscripts: NeumeDocsBundle['manuscripts'] = [];
  for (const entry of (Array.isArray(index.manuscripts) ? index.manuscripts : []).slice(0, MAX_MANUSCRIPTS)) {
    if (!plain(entry)) continue;
    const out = { ...entry } as any;
    const file = typeof entry.file === 'string' ? entry.file : '';
    if (file && !file.split('/').includes('..')) {
      const body = await from.text(file);
      if (body !== undefined) {
        try { out.data = JSON.parse(body); } catch { /* an unreadable file counts as missing */ }
      }
    }
    // only the pictures of lines that are not cut from IIIF are needed
    for (const line of Array.isArray(out.data?.lines) ? out.data.lines : []) {
      const path = typeof line?.image === 'string' ? line.image.trim() : '';
      if (!path || files[path] !== undefined || IMAGE_DATA_URL.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').includes('..')) continue;
      const pic = await from.picture(path);
      if (pic) files[path] = pic;
    }
    manuscripts.push(out);
  }
  return { ...index, manuscripts, files };
}

async function fromZip(buf: ArrayBuffer): Promise<NeumeDocsBundle> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !n.startsWith('__MACOSX/'));
  // the index may lie in a folder of the ZIP (a repository downloaded from GitHub): the shortest path wins
  const indexPath = names.filter(n => baseName(n) === NEUME_DOCS_INDEX).sort((a, b) => a.length - b.length)[0];
  if (!indexPath) throw new Error(`There is no ${NEUME_DOCS_INDEX} in this ZIP.`);
  const prefix = indexPath.slice(0, indexPath.length - NEUME_DOCS_INDEX.length);
  const index = JSON.parse(await zip.files[indexPath].async('string'));
  return assemble(index, {
    text: async (path) => zip.files[prefix + path] ? zip.files[prefix + path].async('string') : undefined,
    picture: async (path) => {
      const mime = MIME[extOf(path)];
      const entry = zip.files[prefix + path];
      if (!mime || !entry) return undefined;
      const bytes = await entry.async('uint8array');
      return bytes.length > MAX_PICTURE_BYTES ? undefined : toDataUrl(bytes, mime);
    }
  });
}

function fromFiles(files: File[], indexFile: File, index: any): Promise<NeumeDocsBundle> {
  // a folder chosen as a whole says where each file lies; single files only have a name
  const full = (f: File): string => ((f as any).webkitRelativePath as string) || f.name;
  const find = (path: string): File | undefined => {
    const exact = files.filter(f => f !== indexFile && ('/' + full(f)).endsWith('/' + path));
    if (exact.length === 1) return exact[0];
    const byName = files.filter(f => f !== indexFile && f.name === baseName(path));
    return byName.length === 1 ? byName[0] : undefined;
  };
  return assemble(index, {
    text: async (path) => find(path)?.text(),
    picture: async (path) => {
      const mime = MIME[extOf(path)];
      const f = find(path);
      if (!mime || !f || f.size > MAX_PICTURE_BYTES) return undefined;
      return toDataUrl(new Uint8Array(await f.arrayBuffer()), mime);
    }
  });
}

/**
 * What a person chose in "Import annotations", as the data `parseAnnotationFile` reads: one JSON file as it
 * is, a ZIP of a documentation, or the files of a documentation chosen together.
 */
export async function readAnnotationFiles(files: File[]): Promise<any> {
  if (!files.length) throw new Error('No file was chosen.');
  const zip = files.find(f => /\.zip$/i.test(f.name) || f.type === 'application/zip');
  if (zip) return fromZip(await zip.arrayBuffer());
  const jsons = files.filter(f => /\.(json|monodijson)$/i.test(f.name));
  if (files.length === 1) return JSON.parse(await files[0].text());
  // several files: the one that is the index, the others are its parts
  for (const f of jsons.sort((a, b) => Number(b.name === NEUME_DOCS_INDEX) - Number(a.name === NEUME_DOCS_INDEX))) {
    let parsed: any;
    try { parsed = JSON.parse(await f.text()); } catch { continue; }
    if (isNeumeDocs(parsed)) return fromFiles(files, f, parsed);
  }
  throw new Error(`Several files were chosen, but none of them is a ${NEUME_DOCS_INDEX}. Choose one file, or a documentation: its ${NEUME_DOCS_INDEX} with the files of data/, or its ZIP.`);
}
